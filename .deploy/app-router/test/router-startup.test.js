'use strict'

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const queryString = require('query-string')
const axios = require('axios')
const moment = require('moment')
const { createRouter, MAX_REQUEST_TARGET_BYTES } = require('../startup')

let router
let backend
let routerPort
let tempDirectory
let rewriteParserCalls = 0
let previousDestinations
let previousServices
let previousApplication
const originalParseUrl = queryString.parseUrl

function request(rawPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port: routerPort, path: rawPath }, res => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { text += chunk })
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }))
    })
    req.setTimeout(5000, () => req.destroy(new Error('Router request did not finish within 5 seconds')))
    req.on('error', reject)
  })
}

before(async () => {
  tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'sap-router-audit-'))
  previousDestinations = process.env.destinations
  previousServices = process.env.VCAP_SERVICES
  previousApplication = process.env.VCAP_APPLICATION
  // Isolated local destination: no XSUAA/HANA/cloud access or default-env file.
  process.env.VCAP_SERVICES = '{}'
  process.env.VCAP_APPLICATION = '{}'
  backend = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ url: req.url }))
  })
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve))
  process.env.destinations = JSON.stringify([{ name: 'audit-backend', url: `http://127.0.0.1:${backend.address().port}` }])
  const reservation = http.createServer()
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
  routerPort = reservation.address().port
  await new Promise(resolve => reservation.close(resolve))
  queryString.parseUrl = function (...args) {
    rewriteParserCalls += 1
    return originalParseUrl.apply(this, args)
  }
  router = createRouter()
  // Test fixture only: production xs-app.json still requires XSUAA and CSRF.
  await new Promise((resolve, reject) => {
    router.start({
      port: routerPort,
      workingDir: tempDirectory,
      xsappConfig: {
        authenticationMethod: 'none',
        routes: [{ source: '^/(.*)$', target: '/$1', destination: 'audit-backend', authenticationType: 'none', csrfProtection: false }]
      }
    }, error => error ? reject(error) : resolve()).catch(reject)
  })
})

after(async () => {
  queryString.parseUrl = originalParseUrl
  if (router) await new Promise((resolve, reject) => router.close(error => error ? reject(error) : resolve()))
  if (backend) await new Promise(resolve => backend.close(resolve))
  for (const [key, value] of [['destinations', previousDestinations], ['VCAP_SERVICES', previousServices], ['VCAP_APPLICATION', previousApplication]]) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  if (tempDirectory) {
    const resolvedDirectory = path.resolve(tempDirectory)
    assert.ok(resolvedDirectory.startsWith(path.resolve(os.tmpdir()) + path.sep))
    assert.ok(path.basename(resolvedDirectory).startsWith('sap-router-audit-'))
    await fs.rm(resolvedDirectory, { recursive: true, force: true })
  }
})

test('actual router starts and forwards valid OData, UTF-8 and duplicate query values', async () => {
  const response = await request('/odata/v4/asset-management/Assets?$filter=assetName%20eq%20%27caf%C3%A9%27&$top=25&tag=a&tag=b&plus=%2B')
  assert.equal(response.status, 200)
  assert.equal(response.body.url, '/odata/v4/asset-management/Assets?$filter=assetName%20eq%20%27caf%C3%A9%27&$top=25&tag=a&tag=b&plus=%2B')
})

test('real sap_idp query rewriting remains compatible with the current CommonJS parser', async () => {
  const initialCalls = rewriteParserCalls
  const response = await request('/probe?sap_idp=test&name=caf%C3%A9&duplicate=a&duplicate=b&empty=')
  assert.equal(response.status, 200)
  assert.ok(rewriteParserCalls > initialCalls, 'This control request must exercise approuter query-string parsing')
  const forwarded = new URL(response.body.url, 'http://localhost')
  assert.equal(forwarded.searchParams.has('sap_idp'), false)
  assert.equal(forwarded.searchParams.get('name'), 'café')
  assert.deepEqual(forwarded.searchParams.getAll('duplicate'), ['a', 'b'])
  assert.equal(forwarded.searchParams.get('empty'), '')
})

test('malformed UTF-8 and incomplete percent escapes are rejected before tolerant query rewriting', async () => {
  for (const encoded of ['%FF'.repeat(120), '%C0%AF'.repeat(100), '%E0%A4', '%', '%ZZ']) {
    const initialCalls = rewriteParserCalls
    const response = await request('/probe?sap_idp=test&bad=' + encoded)
    assert.equal(response.status, 400)
    assert.equal(response.body.error.code, 'INVALID_URL_ENCODING')
    assert.equal(rewriteParserCalls, initialCalls, 'Vulnerable tolerant parser must not receive the rejected target')
  }
})

test('long request URLs fail before query parsing and a subsequent valid request succeeds', async () => {
  const initialCalls = rewriteParserCalls
  const response = await request('/probe?sap_idp=test&query=' + 'a'.repeat(MAX_REQUEST_TARGET_BYTES))
  assert.equal(response.status, 414)
  assert.equal(response.body.error.code, 'REQUEST_TARGET_TOO_LONG')
  assert.equal(rewriteParserCalls, initialCalls)
  assert.equal((await request('/healthy?value=ok')).status, 200)
})

test('patched same-major axios and moment retain the router dependency APIs', async () => {
  const response = await axios.get(`http://127.0.0.1:${backend.address().port}/patched-client?value=ok`, { proxy: false, timeout: 5000 })
  assert.equal(response.status, 200)
  assert.equal(response.data.url, '/patched-client?value=ok')
  assert.equal(moment('2026-10-01T12:00:00Z').utc().format('YYYY-MM-DD'), '2026-10-01')
})
