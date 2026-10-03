sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageToast",
  "sap/m/MessageBox",
  "sap/m/Dialog",
  "sap/m/Button",
  "sap/m/Input",
  "sap/m/Label",
  "sap/m/Select",
  "sap/ui/core/Item",
  "sap/m/DatePicker",
  "sap/m/TextArea",
  "sap/m/VBox",
  "sap/m/Text",
  "sap/ui/core/library",
  "sap/base/Log"
], function (
  Controller,
  MessageToast,
  MessageBox,
  Dialog,
  Button,
  Input,
  Label,
  Select,
  Item,
  DatePicker,
  TextArea,
  VBox,
  Text,
  coreLibrary,
  Log
) {
  "use strict";

  var ValueState = coreLibrary.ValueState;

  var SERVICE_ROOT = "/odata/v4/asset-management/";
  var PAGE_SIZE = 25;
  var DEMO_PROFILES = {
    sap: "SAP identity",
    "it.admin": "Demo IT Admin",
    "employee.alex": "Demo Employee Alex",
    "employee.jamie": "Demo Employee Jamie",
    "compliance.manager": "Demo Compliance Manager"
  };

  function firstDefined() {
    for (var i = 0; i < arguments.length; i += 1) {
      if (arguments[i] !== undefined && arguments[i] !== null && arguments[i] !== "") {
        return arguments[i];
      }
    }
    return "";
  }

  function unwrap(value) {
    if (value && Array.isArray(value.value)) {
      return value.value[0] || {};
    }
    if (value && value.value && typeof value.value === "object") {
      return value.value;
    }
    return value || {};
  }

  function odataCollection(payload) {
    if (Array.isArray(payload)) {
      return payload;
    }
    if (payload && Array.isArray(payload.value)) {
      return payload.value;
    }
    if (payload && Array.isArray(payload.items)) {
      return payload.items;
    }
    return [];
  }

  function errorMessage(payload, status) {
    var message = payload && payload.error && payload.error.message;
    if (message && typeof message === "object") {
      message = message.value || message.message;
    }
    message = message || (payload && (payload.message || payload.errorMessage));
    if (message) {
      return String(message);
    }
    if (status === 401) {
      return "Authentication was rejected. Check the configured local mock user or sign in to SAP BTP.";
    }
    if (status === 403) {
      return "Your signed-in role is not allowed to perform this request.";
    }
    if (status === 404) {
      return "The requested asset or service operation was not found.";
    }
    if (status === 409) {
      return "The asset changed or is no longer eligible. Refresh the record and try again.";
    }
    return "The CAP service returned HTTP " + status + ". Please retry or contact the IT administrator.";
  }

  function escapeODataString(value) {
    return String(value).replace(/'/g, "''");
  }

  function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
  }

  function getRoleNames(session) {
    var roles = firstDefined(session.roles, session.roleNames, session.userRoles, []);
    if (typeof roles === "string") {
      roles = roles.split(/[ ,]+/).filter(Boolean);
    }
    if (!Array.isArray(roles)) {
      roles = Object.keys(roles || {}).filter(function (key) { return roles[key]; });
    }
    return roles.map(function (role) {
      return typeof role === "string" ? role : firstDefined(role.name, role.role, role.value);
    }).filter(Boolean);
  }

  function includesRole(roles, roleName) {
    var wanted = roleName.toLowerCase();
    return roles.some(function (role) {
      var normalized = String(role).replace(/[._\-\s]/g, "").toLowerCase();
      return normalized === wanted.toLowerCase() || normalized.endsWith(wanted.toLowerCase());
    });
  }

  function displayDate(value) {
    if (!value) {
      return "Not recorded";
    }
    return String(value).slice(0, 10);
  }

  return Controller.extend("it.asset.lifecycle.controller.App", {
    onInit: function () {
      this._authorization = "";
      this._csrfToken = "";
      this._csrfChecked = false;
      this._authenticated = false;
      this._sessionGeneration = 0;
      this._demoProfile = "sap";
      this._sessionDialogs = [];
      this._selectedAssetId = "";
      this._searchTimer = null;
      this._employees = [];
      this._assetRows = [];
      this._isMobile = window.matchMedia ? window.matchMedia("(max-width: 760px)").matches : window.innerWidth <= 760;
      if (window.matchMedia) {
        this._mediaQuery = window.matchMedia("(max-width: 760px)");
        this._onMediaChange = this._handleMediaChange.bind(this);
        if (this._mediaQuery.addEventListener) {
          this._mediaQuery.addEventListener("change", this._onMediaChange);
        } else if (this._mediaQuery.addListener) {
          this._mediaQuery.addListener(this._onMediaChange);
        }
      }
    },

    onExit: function () {
      this._sessionGeneration += 1;
      this._closeSessionDialogs();
      if (this._searchTimer) {
        clearTimeout(this._searchTimer);
      }
      if (this._mediaQuery && this._onMediaChange) {
        if (this._mediaQuery.removeEventListener) {
          this._mediaQuery.removeEventListener("change", this._onMediaChange);
        } else if (this._mediaQuery.removeListener) {
          this._mediaQuery.removeListener(this._onMediaChange);
        }
      }
      this._authorization = "";
      this._csrfToken = "";
      this._csrfChecked = false;
    },

    _page: function () {
      return this.getView().getModel("page");
    },

    _set: function (name, value) {
      this._page().setProperty("/" + name, value);
    },

    _isCurrentSession: function (generation) {
      return generation === this._sessionGeneration;
    },

    _assertCurrentSession: function (generation) {
      if (!this._isCurrentSession(generation)) {
        throw Object.assign(new Error("The session changed while this request was in progress."), { staleSession: true });
      }
    },

    _profileHeaders: function (headers) {
      var result = Object.assign({}, headers || {});
      if (this._authorization) {
        result.Authorization = this._authorization;
      }
      if (this._demoProfile !== "sap") {
        result["X-Asset-Demo-Profile"] = this._demoProfile;
      }
      return result;
    },

    _request: async function (path, options) {
      var generation = this._sessionGeneration;
      var requestOptions = Object.assign({
        method: "GET",
        cache: "no-store",
        credentials: "same-origin"
      }, options || {});
      requestOptions.method = String(requestOptions.method || "GET").toUpperCase();
      if (requestOptions.method !== "GET" && requestOptions.method !== "HEAD") {
        await this._ensureCsrfToken(generation);
        this._assertCurrentSession(generation);
      }
      requestOptions.headers = this._profileHeaders(Object.assign({
        Accept: "application/json"
      }, requestOptions.headers || {}));
      if (this._csrfToken) {
        requestOptions.headers["X-CSRF-Token"] = this._csrfToken;
      }
      if (requestOptions.body && !requestOptions.headers["Content-Type"]) {
        requestOptions.headers["Content-Type"] = "application/json; charset=utf-8";
      }

      var response;
      try {
        response = await fetch(SERVICE_ROOT + path, requestOptions);
      } catch (error) {
        this._assertCurrentSession(generation);
        var networkError = new Error("Could not reach the CAP service at " + SERVICE_ROOT + " Check that the local server is running and reachable.");
        networkError.cause = error;
        throw networkError;
      }

      var body = null;
      if (response.status !== 204) {
        var contentType = response.headers.get("content-type") || "";
        if (contentType.indexOf("json") >= 0) {
          body = await response.json().catch(function () { return null; });
        } else {
          var textBody = await response.text().catch(function () { return ""; });
          body = textBody ? { message: textBody } : null;
        }
      }
      this._assertCurrentSession(generation);
      if (!response.ok) {
        var error = new Error(errorMessage(body, response.status));
        error.status = response.status;
        error.payload = body;
        throw error;
      }
      return body;
    },

    _ensureCsrfToken: async function (generation) {
      this._assertCurrentSession(generation);
      if (this._csrfChecked) {
        return;
      }
      var headers = this._profileHeaders({
        Accept: "application/json",
        "X-CSRF-Token": "Fetch"
      });
      try {
        var response = await fetch(SERVICE_ROOT, {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
          headers: headers
        });
        this._assertCurrentSession(generation);
        if (response.status === 401 || response.status === 403) {
          var authBody = await response.json().catch(function () { return null; });
          this._assertCurrentSession(generation);
          throw Object.assign(new Error(errorMessage(authBody, response.status)), { status: response.status });
        }
        if (response.ok) {
          var token = response.headers.get("X-CSRF-Token");
          if (token && token.toLowerCase() !== "required") {
            this._csrfToken = token;
          }
        }
        this._csrfChecked = true;
      } catch (error) {
        this._assertCurrentSession(generation);
        this._csrfChecked = false;
        if (error.status === 401 || error.status === 403) {
          throw error;
        }
        Log.warning("CAP did not provide a CSRF token during the optional fetch: " + error.message, "", "it.asset.lifecycle.controller.App");
      }
    },

    _query: function (path, values) {
      var params = new URLSearchParams();
      Object.keys(values || {}).forEach(function (key) {
        if (values[key] !== undefined && values[key] !== null && values[key] !== "") {
          params.set(key, values[key]);
        }
      });
      // URLSearchParams uses '+' for form-encoded spaces. CAP's OData URL
      // parser expects percent-encoded spaces in expressions such as
      // '$orderby=assetName asc' and '$filter=type eq ...'.
      var query = params.toString().replace(/\+/g, "%20");
      return path + (query ? "?" + query : "");
    },

    _setBusy: function (busy, text, generation) {
      if (generation !== undefined && !this._isCurrentSession(generation)) {
        return;
      }
      this._set("busy", busy);
      if (text) {
        this._set("busyText", text);
      }
    },

    _feedback: function (text, type) {
      this._set("feedbackText", text);
      this._set("feedbackType", type || "Information");
      this._set("feedbackVisible", true);
      if (type === "Success") {
        MessageToast.show(text, { duration: 3200 });
      }
    },

    _reportFailure: function (error, prefix) {
      if (error && error.staleSession) {
        return;
      }
      var text = (prefix ? prefix + " " : "") + (error && error.message ? error.message : "An unexpected error occurred.");
      Log.error(text, error && error.stack, "it.asset.lifecycle.controller.App");
      this._feedback(text, error && error.status === 403 ? "Warning" : "Error");
    },

    onConnect: async function () {
      var loginModel = this.getView().getModel("login");
      var username = String(loginModel.getProperty("/username") || "").trim();
      var password = String(loginModel.getProperty("/password") || "");

      if ((username && !password) || (!username && password)) {
        this._set("loginError", "Enter both local mock user name and password, or leave both empty to use an existing SAP BTP session.");
        this._set("loginErrorVisible", true);
        return;
      }

      var generation = this._beginSession("sap", false);
      this._authorization = username ? "Basic " + window.btoa(username + ":" + password) : "";
      loginModel.setProperty("/password", "");
      await this._connectSession(generation, false);
    },

    onDemoProfileChange: async function (event) {
      var profile = event.getSource().getSelectedKey();
      if (!this._page().getProperty("/demoProfilesAvailable") || !Object.prototype.hasOwnProperty.call(DEMO_PROFILES, profile) || profile === this._demoProfile) {
        return;
      }
      var generation = this._beginSession(profile, true);
      await this._connectSession(generation, true);
    },

    _closeSessionDialogs: function () {
      (this._sessionDialogs || []).slice().forEach(function (dialog) {
        dialog.destroy();
      });
      this._sessionDialogs = [];
    },

    _clearSessionData: function () {
      if (this._searchTimer) {
        clearTimeout(this._searchTimer);
        this._searchTimer = null;
      }
      this._closeSessionDialogs();
      this._csrfToken = "";
      this._csrfChecked = false;
      this._authenticated = false;
      this._selectedAssetId = "";
      this._assetRows = [];
      this._employees = [];
      var cleared = {
        userId: "", roleLabel: "", businessToday: "", timeZone: "",
        hasBusinessRole: false, canAdmin: false, canCompliance: false, isEmployee: false,
        activeSection: "", listVisible: false, inventoryVisible: false, myAssetsVisible: false, complianceVisible: false,
        detailVisible: false, mobileDetail: false, selected: null, hasSelection: false,
        selectedTitle: "Select an asset", selectedStatus: "", selectedStatusState: "None",
        detailComplianceText: "", detailComplianceVisible: false, detailComplianceType: "Information",
        historyCaption: "", history: [], historyLoaded: false, historyLoading: false,
        items: [], employees: [], complianceGroups: [], counts: {},
        complianceIntro: "Software license compliance and hardware warranty coverage are shown separately. Lifecycle status remains independent of expiry alerts.",
        query: "", filterStatus: "", filterType: "", skip: 0, pageNumber: 1,
        totalCount: 0, hasMore: false, hasPrevious: false, listTitle: "", listHelp: "",
        feedbackText: "", feedbackVisible: false, loginError: "", loginErrorVisible: false,
        demoProfileDescription: ""
      };
      Object.keys(cleared).forEach(function (name) { this._set(name, cleared[name]); }, this);
      this._updateActionVisibility(null);
      this._applyMobilePanels(false);
    },

    _beginSession: function (profile, keepDemoAccess) {
      this._sessionGeneration += 1;
      this._clearSessionData();
      this._demoProfile = profile;
      this._set("activeDemoProfile", profile);
      this._set("demoProfileLabel", DEMO_PROFILES[profile]);
      this._set("connected", !!keepDemoAccess);
      this._set("loginVisible", !keepDemoAccess);
      if (!keepDemoAccess) {
        this._set("authenticationMode", "");
        this._set("demoProfilesAvailable", false);
        this._set("demoOperatorUserId", "");
      }
      return this._sessionGeneration;
    },

    _connectSession: async function (generation, profileChange) {
      this._setBusy(true, "Checking your CAP session…");

      try {
        var raw = await this._request("sessionInfo()", { method: "GET" });
        this._assertCurrentSession(generation);
        var session = unwrap(raw);
        var roles = getRoleNames(session);
        var admin = includesRole(roles, "ITAdmin");
        var compliance = includesRole(roles, "ComplianceManager") || admin;
        var employee = includesRole(roles, "Employee");
        var demoAvailable = session.demoProfilesAvailable === true;
        var hasBusinessRole = admin || compliance || employee;
        if (!hasBusinessRole && !demoAvailable) {
          throw new Error("The authenticated CAP session did not report Employee, ITAdmin, or ComplianceManager access.");
        }
        var activeProfile = firstDefined(session.activeDemoProfile, "sap");
        if (!Object.prototype.hasOwnProperty.call(DEMO_PROFILES, activeProfile) || (!demoAvailable && activeProfile !== "sap") || activeProfile !== this._demoProfile) {
          throw new Error("CAP did not confirm the requested demo profile. Reconnect using your SAP identity.");
        }

        this._authenticated = true;
        this._set("connected", true);
        this._set("loginVisible", false);
        this._set("loginErrorVisible", false);
        this._set("authenticationMode", firstDefined(session.authenticationMode, ""));
        this._set("demoProfilesAvailable", demoAvailable);
        this._set("demoOperatorUserId", firstDefined(session.demoOperatorUserId, ""));
        this._set("activeDemoProfile", activeProfile);
        this._set("demoProfileLabel", DEMO_PROFILES[activeProfile]);
        this._set("demoProfileDescription", activeProfile === "sap"
          ? "Using your SAP identity. Choose a demo profile to explore its server-authorized view."
          : "Demo profile: " + DEMO_PROFILES[activeProfile] + " · " + activeProfile + ". Employee Alex and Employee Jamie are demo aliases. SAP operator: " + firstDefined(session.demoOperatorUserId, "signed-in SAP user") + ".");
        this._set("hasBusinessRole", hasBusinessRole);
        this._set("userId", firstDefined(session.userId, session.userID, session.id, session.subject, "Signed-in user"));
        this._set("businessToday", firstDefined(session.businessToday, session.today, ""));
        this._set("timeZone", firstDefined(session.timeZone, ""));
        this._set("canAdmin", admin);
        this._set("canCompliance", compliance);
        this._set("isEmployee", employee);
        this._set("roleLabel", roles.join(", ") || "Demo operator");

        if (!hasBusinessRole) {
          this._feedback("Your SAP identity is authorized to use demo profiles. Choose a Demo profile above to open its permitted view.", "Information");
          return;
        }

        var firstSection = admin ? "inventory" : (employee ? "myAssets" : "compliance");
        this._set("activeSection", firstSection);
        this._set("listVisible", firstSection !== "compliance");
        this._set("complianceVisible", firstSection === "compliance");
        this._set("listTitle", firstSection === "myAssets" ? "My assigned assets" : "Asset inventory");
        this._set("listHelp", firstSection === "myAssets"
          ? "The server limits this list to assets assigned to your authenticated identity."
          : "Search and filter results are requested from CAP. Inventory pages contain up to " + PAGE_SIZE + " assets.");
        var tabs = this.byId("sectionTabs");
        if (tabs) {
          tabs.setSelectedKey(firstSection);
        }

        this._applyMobilePanels(false);
        this._setBusy(true, "Loading your authorized view…");
        var employeeWarning = "";
        if (admin) {
          try {
            await this._loadEmployees();
            this._assertCurrentSession(generation);
          } catch (employeeError) {
            this._assertCurrentSession(generation);
            this._employees = [];
            employeeWarning = "Inventory access is available, but the employee mapping could not be read: " + employeeError.message;
          }
        }
        if (firstSection === "compliance") {
          await this._loadCompliance();
        } else {
          await this._loadAssets(true);
        }
        this._assertCurrentSession(generation);
        this._feedback(employeeWarning || "Connected. Your view is filtered by the role reported by CAP.", employeeWarning ? "Warning" : "Success");
      } catch (error) {
        if (!this._isCurrentSession(generation) || error.staleSession) {
          return;
        }
        this._clearSessionData();
        var canChooseProfile = profileChange && this._page().getProperty("/demoProfilesAvailable");
        this._set("connected", !!canChooseProfile);
        this._set("loginVisible", !canChooseProfile);
        if (canChooseProfile) {
          this._set("userId", this._page().getProperty("/demoOperatorUserId"));
          this._feedback((error.message || "Unable to load this demo profile.") + " Choose another demo profile or SAP identity to retry.", "Error");
        } else {
          this._authorization = "";
          this._set("demoProfilesAvailable", false);
          this._set("loginError", error.message || "Unable to connect to CAP.");
          this._set("loginErrorVisible", true);
        }
        if (error.status !== 401 && error.status !== 403) {
          Log.error(error.message, error.stack, "it.asset.lifecycle.controller.App");
        }
      } finally {
        if (this._isCurrentSession(generation)) {
          this._setBusy(false);
        }
      }
    },

    onSignOut: function () {
      var authenticationMode = this._page().getProperty("/authenticationMode");
      this._authorization = "";
      this._beginSession("sap", false);
      this._setBusy(false);
      this.getView().getModel("login").setProperty("/password", "");
      this.getView().getModel("login").setProperty("/username", "");
      if (authenticationMode === "xsuaa") {
        window.location.assign("/logout");
      } else {
        this.byId("loginUsername").focus();
      }
    },

    onCloseFeedback: function () {
      this._set("feedbackVisible", false);
    },

    onSectionChange: async function (event) {
      var key = event.getParameter("key");
      if (!key || !this._authenticated || !this._page().getProperty("/hasBusinessRole")) {
        return;
      }
      var generation = this._sessionGeneration;
      this._selectedAssetId = "";
      this._set("activeSection", key);
      this._set("selected", null);
      this._set("hasSelection", false);
      this._set("history", []);
      this._set("detailVisible", true);
      this._set("listVisible", key !== "compliance");
      this._set("complianceVisible", key === "compliance");
      this._set("pageNumber", 1);
      this._set("skip", 0);
      if (key === "myAssets") {
        this._set("listTitle", "My assigned assets");
        this._set("listHelp", "The server limits this list to assets assigned to your authenticated identity.");
      } else {
        this._set("listTitle", "Asset inventory");
        this._set("listHelp", "Search and filter results are requested from CAP. Inventory pages contain up to " + PAGE_SIZE + " assets.");
      }
      this._applyMobilePanels(false);
      this._setBusy(true, key === "compliance" ? "Loading compliance alerts…" : "Loading assets…");
      try {
        if (key === "compliance") {
          await this._loadCompliance();
        } else {
          await this._loadAssets(true);
        }
      } catch (error) {
        this._reportFailure(error, "The view could not be loaded.");
      } finally {
        this._setBusy(false, "", generation);
      }
    },

    onSearch: function () {
      this._set("skip", 0);
      this._set("pageNumber", 1);
      this._loadAssetsSafe();
    },

    onLiveSearch: function (event) {
      var value = event.getParameter("newValue") || "";
      this._set("query", value);
      this._set("skip", 0);
      this._set("pageNumber", 1);
      if (this._searchTimer) {
        clearTimeout(this._searchTimer);
      }
      this._searchTimer = setTimeout(this._loadAssetsSafe.bind(this), 400);
    },

    onFilterChange: function () {
      this._set("skip", 0);
      this._set("pageNumber", 1);
      this._loadAssetsSafe();
    },

    onPreviousPage: function () {
      var skip = Math.max(0, Number(this._page().getProperty("/skip") || 0) - PAGE_SIZE);
      this._set("skip", skip);
      this._set("pageNumber", Math.max(1, Math.floor(skip / PAGE_SIZE) + 1));
      this._loadAssetsSafe();
    },

    onNextPage: function () {
      var skip = Number(this._page().getProperty("/skip") || 0) + PAGE_SIZE;
      this._set("skip", skip);
      this._set("pageNumber", Math.floor(skip / PAGE_SIZE) + 1);
      this._loadAssetsSafe();
    },

    onRefresh: async function () {
      if (!this._authenticated || !this._page().getProperty("/hasBusinessRole")) {
        return;
      }
      var generation = this._sessionGeneration;
      this._setBusy(true, "Refreshing from CAP…");
      try {
        if (this._page().getProperty("/activeSection") === "compliance") {
          await this._loadCompliance();
        } else {
          await this._loadAssets(true);
        }
        this._assertCurrentSession(generation);
        this._feedback("View refreshed from the CAP service.", "Success");
      } catch (error) {
        this._reportFailure(error, "Refresh failed.");
      } finally {
        this._setBusy(false, "", generation);
      }
    },

    _loadAssetsSafe: async function () {
      if (!this._authenticated || !this._page().getProperty("/hasBusinessRole") || this._page().getProperty("/activeSection") === "compliance") {
        return;
      }
      var generation = this._sessionGeneration;
      this._setBusy(true, "Loading assets from CAP…");
      try {
        await this._loadAssets(true);
      } catch (error) {
        this._reportFailure(error, "Assets could not be loaded.");
      } finally {
        this._setBusy(false, "", generation);
      }
    },

    _loadAssets: async function (preserveSelection) {
      var generation = this._sessionGeneration;
      var page = this._page();
      var activeSection = page.getProperty("/activeSection");
      var collection = activeSection === "myAssets" ? "MyAssets" : "Assets";
      var skip = Number(page.getProperty("/skip") || 0);
      var filters = [];
      var query = String(page.getProperty("/query") || "").trim();
      var type = page.getProperty("/filterType");
      var status = page.getProperty("/filterStatus");

      if (query) {
        if (isUuid(query)) {
          filters.push("assetID eq " + query);
        } else {
          var term = escapeODataString(query.toLowerCase());
          filters.push("(contains(tolower(assetName),'" + term + "') or contains(tolower(type),'" + term + "'))");
        }
      }
      if (type) {
        filters.push("type eq '" + escapeODataString(type) + "'");
      }
      if (status) {
        filters.push("status eq '" + escapeODataString(status) + "'");
      }

      var queryValues = {
        "$top": PAGE_SIZE,
        "$skip": skip,
        "$count": "true",
        "$orderby": "assetName asc"
      };
      if (filters.length) {
        queryValues["$filter"] = filters.join(" and ");
      }

      var previousId = preserveSelection ? this._selectedAssetId : "";
      var payload = await this._request(this._query(collection, queryValues));
      this._assertCurrentSession(generation);
      var rows = odataCollection(payload);
      this._assetRows = rows;
      page.setProperty("/items", rows);
      page.setProperty("/totalCount", payload && payload["@odata.count"] !== undefined ? Number(payload["@odata.count"]) : rows.length);
      page.setProperty("/hasMore", rows.length === PAGE_SIZE && (payload && payload["@odata.count"] !== undefined ? skip + rows.length < Number(payload["@odata.count"]) : true));
      page.setProperty("/hasPrevious", skip > 0);
      page.setProperty("/pageSize", PAGE_SIZE);

      if (previousId) {
        var stillVisible = rows.find(function (asset) { return asset.assetID === previousId; });
        if (stillVisible) {
          await this._selectAsset(stillVisible, false);
        } else {
          this._selectedAssetId = "";
          page.setProperty("/selected", null);
          page.setProperty("/hasSelection", false);
          page.setProperty("/history", []);
          this._updateActionVisibility(null);
          this._applyMobilePanels(false);
        }
      }
    },

    _loadEmployees: async function () {
      var generation = this._sessionGeneration;
      var payload = await this._request(this._query("Employees", {
        "$top": 500,
        "$skip": 0,
        "$orderby": "displayName asc"
      }));
      this._assertCurrentSession(generation);
      this._employees = odataCollection(payload).filter(function (person) {
        return person.active !== false && person.enabled !== false;
      }).map(function (person) {
        return Object.assign({}, person, {
          userId: firstDefined(person.userId, person.userID, person.employeeUserId, person.ID),
          displayName: firstDefined(person.displayName, person.employeeName, person.name, person.userId)
        });
      }).filter(function (person) { return !!person.userId; });
      this._set("employees", this._employees);
    },

    onSelectAsset: async function (event) {
      var context = event.getSource().getBindingContext("page");
      if (context) {
        await this._selectAsset(context.getObject(), true);
      }
    },

    _selectAsset: async function (asset, moveToDetail) {
      if (!this._authenticated || !asset || !asset.assetID) {
        return;
      }
      var generation = this._sessionGeneration;
      this._selectedAssetId = asset.assetID;
      this._set("selected", asset);
      this._set("hasSelection", true);
      this._set("selectedStatus", asset.status || "Status not reported");
      this._set("selectedStatusState", this._statusState(asset.status));
      this._set("detailVisible", true);
      this._set("history", []);
      this._set("historyLoaded", false);
      this._set("historyLoading", !!this._page().getProperty("/canAdmin"));
      this._set("detailComplianceText", firstDefined(asset.complianceLabel, asset.complianceStatus, ""));
      this._set("detailComplianceVisible", !!firstDefined(asset.complianceLabel, asset.complianceStatus, ""));
      this._set("detailComplianceType", this._complianceMessageType(asset.complianceLabel || asset.complianceStatus));
      this._set("historyCaption", this._page().getProperty("/canAdmin") ? "Allocation history" : "Allocation history is restricted to IT Admins.");
      this._updateActionVisibility(asset);
      if (moveToDetail) {
        this._applyMobilePanels(true);
      }

      if (this._page().getProperty("/canAdmin")) {
        try {
          var assetId = asset.assetID;
          var payload = await this._request(this._query("AllocationHistories", {
            "$filter": "assetID_assetID eq " + assetId,
            "$orderby": "assignedDate desc",
            "$top": 100,
            "$skip": 0
          }));
          this._assertCurrentSession(generation);
          if (this._selectedAssetId === assetId) {
            this._set("history", odataCollection(payload));
            this._set("historyLoaded", true);
            this._set("historyLoading", false);
            this._updateActionVisibility(asset);
          }
        } catch (error) {
          if (!this._isCurrentSession(generation) || error.staleSession || this._selectedAssetId !== asset.assetID) {
            return;
          }
          this._set("history", []);
          this._set("historyLoaded", false);
          this._set("historyLoading", false);
          this._reportFailure(error, "Allocation history could not be loaded.");
        }
      } else {
        this._set("history", []);
        this._set("historyLoaded", false);
        this._set("historyLoading", false);
      }
    },

    _updateActionVisibility: function (asset) {
      var admin = !!this._page().getProperty("/canAdmin");
      var status = asset && asset.status;
      var isSoftware = asset && String(asset.type).toLowerCase() === "software";
      var hasHistory = this._page().getProperty("/history").length > 0;
      this._set("showEdit", admin && !!asset && status !== "Retired");
      this._set("showAllocate", admin && !!asset && status === "Available");
      this._set("showReturn", admin && !!asset && status === "Allocated");
      this._set("showRenew", admin && !!asset && isSoftware && status !== "Retired");
      this._set("showMaintenance", admin && !!asset && status === "Available");
      this._set("showRelease", admin && !!asset && status === "In Maintenance");
      this._set("showRetire", admin && !!asset && (status === "Available" || status === "In Maintenance"));
      this._set("showDelete", admin && !!asset && status === "Available" && this._page().getProperty("/historyLoaded") && !hasHistory);
    },

    _statusState: function (status) {
      if (status === "Allocated") {
        return "Information";
      }
      if (status === "In Maintenance") {
        return "Warning";
      }
      if (status === "Retired") {
        return "None";
      }
      return "Success";
    },

    _complianceMessageType: function (label) {
      var value = String(label || "").toLowerCase();
      if (value.indexOf("expired") >= 0) {
        return "Error";
      }
      if (value.indexOf("expiring") >= 0) {
        return "Warning";
      }
      return "Information";
    },

    _applyMobilePanels: function (showDetail) {
      var master = this.byId("masterPanel");
      var detail = this.byId("detailPanel");
      if (!master || !detail) {
        return;
      }
      if (this._isMobile) {
        master.toggleStyleClass("mobileHidden", !!showDetail);
        detail.toggleStyleClass("mobileHidden", !showDetail);
        this._set("mobileDetail", !!showDetail);
      } else {
        master.removeStyleClass("mobileHidden");
        detail.removeStyleClass("mobileHidden");
        this._set("mobileDetail", false);
      }
    },

    _handleMediaChange: function (event) {
      this._isMobile = !!event.matches;
      this._applyMobilePanels(!!this._selectedAssetId);
    },

    onBackToList: function () {
      this._applyMobilePanels(false);
    },

    _loadCompliance: async function () {
      var generation = this._sessionGeneration;
      var raw = await this._request("complianceAlerts()", { method: "GET" });
      this._assertCurrentSession(generation);
      var summary = unwrap(raw);
      if (summary.businessToday) {
        this._set("businessToday", summary.businessToday);
      }
      this._set("complianceIntro", "Business date: " + firstDefined(summary.businessToday, this._page().getProperty("/businessToday"), "not reported") +
        ((summary.timeZone || this._page().getProperty("/timeZone")) ? " · " + firstDefined(summary.timeZone, this._page().getProperty("/timeZone")) : "") +
        ". A software license is expired only when its expiry date is before this business date; expiry today remains valid. The warning window includes today through " + firstDefined(summary.expiryWarningDays, 30) + " calendar days. An asset is idle after more than " + firstDefined(summary.idleThresholdDays, 30) + " full calendar days available. Hardware warranties are separate from software licenses.");
      var grouped = this._normalizeCompliance(summary);
      this._set("complianceGroups", grouped);
      this._set("counts", {
        expiredLicenses: grouped[0].items.length,
        expiringLicenses: grouped[1].items.length,
        hardwareWarrantyAlerts: grouped[2].items.length,
        idleAssets: grouped[3].items.length,
        missingDateAlerts: grouped[4].items.length
      });
    },

    _normalizeCompliance: function (raw) {
      var response = unwrap(raw);
      var groups = [
        { title: "Expired software licenses", items: [] },
        { title: "Software licenses expiring soon", items: [] },
        { title: "Hardware warranty alerts", items: [] },
        { title: "Idle available assets", items: [] },
        { title: "Missing expiry or warranty dates", items: [] }
      ];
      var categories = [
        ["expiredLicenses", "expiredSoftwareLicenses", "expired"],
        ["expiringLicenses", "expiringSoftwareLicenses", "expiringSoon"],
        ["hardwareWarrantyAlerts", "warrantyAlerts", "hardwareAlerts"],
        ["idleAssets", "idle"],
        ["missingDateAlerts", "missingExpiryDates", "noExpiryDate"]
      ];
      var consumed = [];
      var foundGrouped = false;

      categories.forEach(function (keys, groupIndex) {
        keys.forEach(function (key) {
          if (response && response[key] !== undefined) {
            foundGrouped = true;
            var records = odataCollection(response[key]);
            records.forEach(function (record) {
              groups[groupIndex].items.push(this._complianceRow(record, groupIndex));
              consumed.push(record);
            }, this);
          }
        }, this);
      }, this);

      var ungroupedArrays = ["alerts", "items", "results", "value"];
      ungroupedArrays.forEach(function (key) {
        if (response && Array.isArray(response[key])) {
          response[key].forEach(function (record) {
            if (consumed.indexOf(record) < 0) {
              var groupIndex = this._classifyAlert(record);
              if (groupIndex >= 0) {
                groups[groupIndex].items.push(this._complianceRow(record, groupIndex));
              }
            }
          }, this);
        }
      }, this);

      if (Array.isArray(raw)) {
        raw.forEach(function (record) {
          var groupIndex = this._classifyAlert(record);
          if (groupIndex >= 0) {
            groups[groupIndex].items.push(this._complianceRow(record, groupIndex));
          }
        }, this);
      }

      if (!foundGrouped && !groups.some(function (group) { return group.items.length > 0; })) {
        var singleRows = odataCollection(response);
        singleRows.forEach(function (record) {
          var groupIndex = this._classifyAlert(record);
          if (groupIndex >= 0) {
            groups[groupIndex].items.push(this._complianceRow(record, groupIndex));
          }
        }, this);
      }

      groups.forEach(function (group) {
        var seen = new Set();
        group.items = group.items.filter(function (row) {
          var key = row.assetID + "|" + row.alertLabel;
          if (seen.has(key)) {
            return false;
          }
          seen.add(key);
          return true;
        });
      });
      return groups;
    },

    _classifyAlert: function (record) {
      var kind = String(firstDefined(record.alertType, record.category, record.complianceLabel, record.complianceStatus, record.issue, record.alertLabel, record.status, "")).toLowerCase();
      var type = String(firstDefined(record.type, record.assetType, "")).toLowerCase();
      if (kind.indexOf("idle") >= 0 || record.isIdle === true || record.idle === true) {
        return 3;
      }
      if (kind.indexOf("missing") >= 0 || kind.indexOf("no expiry") >= 0 || kind.indexOf("noexpiry") >= 0 || kind.indexOf("no warranty") >= 0 || kind.indexOf("nowarranty") >= 0) {
        return 4;
      }
      if (type === "hardware" || kind.indexOf("warranty") >= 0) {
        return 2;
      }
      if (kind.indexOf("expired") >= 0) {
        return 0;
      }
      if (kind.indexOf("expiring") >= 0 || kind.indexOf("soon") >= 0) {
        return 1;
      }
      return -1;
    },

    _complianceRow: function (record, groupIndex) {
      var assetId = firstDefined(record.assetID, record.ID, record.id, record.asset && record.asset.assetID, "");
      var name = firstDefined(record.assetName, record.name, record.title, record.description, "Asset " + assetId);
      var status = firstDefined(record.status, "");
      var label = firstDefined(record.alertLabel, record.complianceLabel, record.complianceStatus, record.alertType, status, groupsafeLabel(groupIndex));
      var detail = [];
      if (record.type || record.assetType) {
        detail.push(firstDefined(record.type, record.assetType));
      }
      if (record.expiryDate) {
        detail.push("Expiry / warranty " + displayDate(record.expiryDate));
      }
      if (record.idleSince || record.idleBaseline) {
        detail.push("Available since " + displayDate(firstDefined(record.idleSince, record.idleBaseline)));
      }
      if (record.daysRemaining !== undefined && record.daysRemaining !== null) {
        var daysRemaining = Number(record.daysRemaining);
        if (daysRemaining < 0) {
          var overdueDays = Math.abs(daysRemaining);
          var isHardware = String(firstDefined(record.type, record.assetType, "")).toLowerCase() === "hardware";
          detail.push(isHardware ? "Warranty expired " + overdueDays + " days ago" : "Expired " + overdueDays + " days ago");
        } else if (daysRemaining === 0) {
          detail.push("Expires today (valid through today)");
        } else {
          detail.push(String(daysRemaining) + " days until expiry");
        }
      } else if (record.daysUntilExpiry !== undefined && record.daysUntilExpiry !== null) {
        var daysUntilExpiry = Number(record.daysUntilExpiry);
        if (daysUntilExpiry < 0) {
          detail.push("Expired " + Math.abs(daysUntilExpiry) + " days ago");
        } else if (daysUntilExpiry === 0) {
          detail.push("Expires today (valid through today)");
        } else {
          detail.push(String(daysUntilExpiry) + " days until expiry");
        }
      }
      if (record.daysIdle !== undefined && record.daysIdle !== null) {
        detail.push(String(record.daysIdle) + " days available");
      }
      if (assetId) {
        detail.push("Asset ID " + assetId);
      }
      return Object.assign({}, record, {
        assetID: assetId,
        assetName: name,
        status: status,
        alertLabel: label,
        detailText: detail.join(" · ") || label
      });
    },

    onProvisionEmployee: function () {
      var userId = new Input({ maxLength: 255, required: true, placeholder: "Authenticated user ID from My Assets" });
      var displayName = new Input({ maxLength: 200, required: true });
      var fields = { content: [
        this._labelControl("Authenticated employee user ID", userId, true),
        this._labelControl("Employee display name", displayName, true),
        new Text({ text: "Use the exact, case-sensitive identity reported after SAP BTP sign-in. This adds an allocation mapping; the Employee role is assigned separately in SAP BTP." }).addStyleClass("dialogHelp")
      ] };
      var dialog = this._formDialog("Add employee identity mapping", fields, "Add employee", async function () {
        if (!userId.getValue().trim() || !displayName.getValue().trim()) {
          this._feedback("Enter an authenticated user ID and employee display name.", "Warning");
          return false;
        }
        await this._request("provisionEmployee", {
          method: "POST",
          body: JSON.stringify({ userId: userId.getValue().trim(), displayName: displayName.getValue() })
        });
        await this._loadEmployees();
        this._feedback("Employee identity mapping added. The employee is now available for allocation.", "Success");
        return true;
      });
      this.getView().addDependent(dialog);
      dialog.open();
    },

    onRegisterAsset: function () {
      var fields = this._assetFormFields();
      var dialog = this._formDialog("Register purchased asset", fields, "Register", async function () {
        var assetName = fields.assetName.getValue().trim();
        var type = fields.type.getSelectedKey();
        var purchaseDate = fields.purchaseDate.getValue();
        var expiryDate = fields.expiryDate.getValue();
        if (!assetName || !type || !purchaseDate || (type === "Software" && !expiryDate)) {
          this._feedback("Enter an asset name, type, purchase date, and software expiry date when registering a license.", "Warning");
          return false;
        }
        var payload = {
          assetName: assetName,
          type: type,
          purchaseDate: purchaseDate
        };
        if (expiryDate) {
          payload.expiryDate = expiryDate;
        }
        await this._request("Assets", { method: "POST", body: JSON.stringify(payload) });
        this._set("query", "");
        this._set("filterStatus", "");
        this._set("filterType", "");
        this._set("skip", 0);
        this._set("pageNumber", 1);
        this._feedback("Asset registered. CAP set its lifecycle status to Available.", "Success");
        await this._refreshAfterMutation();
        return true;
      });
      this.getView().addDependent(dialog);
      dialog.open();
    },

    _assetFormFields: function (existing) {
      var name = new Input({ value: existing ? existing.assetName : "", maxLength: 160, required: true });
      var type = new Select({
        selectedKey: existing ? existing.type : "Hardware",
        enabled: !existing,
        items: [new Item({ key: "Hardware", text: "Hardware" }), new Item({ key: "Software", text: "Software" })]
      });
      var purchase = new DatePicker({
        value: existing ? displayDate(existing.purchaseDate) : this._businessToday(),
        valueFormat: "yyyy-MM-dd",
        displayFormat: "yyyy-MM-dd",
        required: true,
        enabled: !existing,
        placeholder: "YYYY-MM-DD"
      });
      var expiry = new DatePicker({
        value: existing ? displayDate(existing.expiryDate) : "",
        valueFormat: "yyyy-MM-dd",
        displayFormat: "yyyy-MM-dd",
        required: !existing && type.getSelectedKey() === "Software",
        enabled: !existing,
        placeholder: "YYYY-MM-DD"
      });
      var expiryLabel = new Label({
        text: "Expiry / warranty date",
        labelFor: expiry.getId(),
        required: !existing && type.getSelectedKey() === "Software"
      });
      if (!existing) {
        type.attachChange(function (event) {
          var softwareSelected = event.getSource().getSelectedKey() === "Software";
          expiry.setRequired(softwareSelected);
          expiryLabel.setRequired(softwareSelected);
        });
      }
      return {
        assetName: name,
        type: type,
        purchaseDate: purchase,
        expiryDate: expiry,
        content: [
          this._labelControl("Asset name", name, true),
          this._labelControl("Type", type, true),
          this._labelControl("Purchase date", purchase, true),
          expiryLabel,
          expiry,
          new Text({ text: existing ? "Lifecycle, identity, purchase, and expiry fields are managed through CAP lifecycle actions." : "Software expiry is required. Hardware warranty end date is optional. CAP validates date boundaries." }).addStyleClass("dialogHelp")
        ]
      };
    },

    _businessToday: function () {
      var today = this._page().getProperty("/businessToday");
      if (today) {
        return String(today).slice(0, 10);
      }
      var parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
      var values = {};
      parts.forEach(function (part) { values[part.type] = part.value; });
      return values.year + "-" + values.month + "-" + values.day;
    },

    _labelControl: function (text, control, required) {
      var label = new Label({ text: text, labelFor: control.getId(), required: !!required });
      return [label, control];
    },

    _formDialog: function (title, fieldSet, submitText, onSubmit, options) {
      var generation = this._sessionGeneration;
      var settings = options || {};
      var contentItems = [];
      fieldSet.content.forEach(function (item) {
        if (Array.isArray(item)) {
          contentItems = contentItems.concat(item);
        } else {
          contentItems.push(item);
        }
      });
      var formBox = new VBox({ items: contentItems });
      formBox.addStyleClass("assetDialogForm");
      var dialog = new Dialog({
        title: title,
        contentWidth: settings.contentWidth || "30rem",
        resizable: true,
        draggable: true,
        content: [formBox],
        beginButton: new Button({
          text: submitText,
          type: "Emphasized",
          press: async function () {
            if (!this._isCurrentSession(generation)) {
              return;
            }
            var button = dialog.getBeginButton();
            button.setEnabled(false);
            try {
              var accepted = await onSubmit.call(this, dialog);
              this._assertCurrentSession(generation);
              if (accepted !== false) {
                dialog.close();
              }
            } catch (error) {
              this._reportFailure(error, "The request was rejected.");
            } finally {
              if (this._isCurrentSession(generation) && !button.isDestroyed()) {
                button.setEnabled(true);
              }
            }
          }.bind(this)
        }),
        endButton: new Button({
          text: "Cancel",
          press: function () { dialog.close(); }
        })
      });
      dialog.addStyleClass("assetDialog");
      this._sessionDialogs.push(dialog);
      dialog.attachAfterClose(function () {
        this._sessionDialogs = this._sessionDialogs.filter(function (openDialog) { return openDialog !== dialog; });
        dialog.destroy();
      }.bind(this));
      return dialog;
    },

    onEditAsset: function () {
      var asset = this._page().getProperty("/selected");
      if (!asset) { return; }
      var name = new Input({ value: asset.assetName || "", maxLength: 160, required: true });
      var fields = { assetName: name, content: this._labelControl("Asset name", name, true) };
      var dialog = this._formDialog("Edit asset description", fields, "Save", async function () {
        var value = name.getValue().trim();
        if (!value) {
          name.setValueState(ValueState.Error);
          name.setValueStateText("Enter a name.");
          return false;
        }
        await this._request(this._entityPath("Assets", asset.assetID), {
          method: "PATCH",
          body: JSON.stringify({ assetName: value })
        });
        this._feedback("Asset description updated.", "Success");
        await this._reloadSelectionAndList();
        return true;
      });
      this.getView().addDependent(dialog);
      dialog.open();
    },

    onAllocate: function () {
      var asset = this._page().getProperty("/selected");
      if (!asset) { return; }
      var employeeSelect = new Select({ width: "100%", required: true });
      this._employees.forEach(function (person) {
        employeeSelect.addItem(new Item({ key: person.userId, text: person.displayName + " · " + person.userId }));
      });
      if (!this._employees.length) {
        this._feedback("No enabled employees are available. Check the protected employee identity mapping.", "Warning");
        return;
      }
      var fields = {
        employee: employeeSelect,
        content: [
          this._labelControl("Assign to employee", employeeSelect, true),
          new Text({ text: "The employee identity key is sent to CAP. The server resolves the trusted display name and creates allocation history." }).addStyleClass("dialogHelp")
        ]
      };
      var dialog = this._formDialog("Allocate " + asset.assetName, fields, "Allocate", async function () {
        var employeeUserId = employeeSelect.getSelectedKey();
        if (!employeeUserId) {
          this._feedback("Select an enabled employee before allocating this asset.", "Warning");
          return false;
        }
        await this._request("allocateAsset", {
          method: "POST",
          body: JSON.stringify({ assetID: asset.assetID, employeeUserId: employeeUserId })
        });
        this._feedback("Asset allocated. CAP recorded the assignment and changed status to Allocated.", "Success");
        await this._reloadSelectionAndList();
        return true;
      });
      this.getView().addDependent(dialog);
      dialog.open();
    },

    onReturn: function () {
      var generation = this._sessionGeneration;
      var asset = this._page().getProperty("/selected");
      if (!asset) { return; }
      MessageBox.confirm("Return " + asset.assetName + " and close its active allocation record?", {
        title: "Return asset",
        actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
        emphasizedAction: MessageBox.Action.OK,
        onClose: async function (action) {
          if (action !== MessageBox.Action.OK || !this._isCurrentSession(generation)) { return; }
          await this._runLifecycleAction("returnAsset", { assetID: asset.assetID }, "Asset returned. CAP closed the active history record and restored Available status.");
        }.bind(this)
      });
    },

    onRenew: function () {
      var asset = this._page().getProperty("/selected");
      if (!asset) { return; }
      var expiry = new DatePicker({
        value: "",
        valueFormat: "yyyy-MM-dd",
        displayFormat: "yyyy-MM-dd",
        required: true,
        placeholder: "YYYY-MM-DD"
      });
      var fields = {
        expiry: expiry,
        content: [
          new Text({ text: "Current expiry: " + displayDate(asset.expiryDate) + ". Renewal must extend the date beyond both today and the current expiry." }).addStyleClass("dialogHelp"),
          this._labelControl("New expiry date", expiry, true)
        ]
      };
      var dialog = this._formDialog("Renew software license", fields, "Renew", async function () {
        if (!expiry.getValue()) {
          this._feedback("Enter a new expiry date.", "Warning");
          return false;
        }
        await this._request("renewSoftwareLicense", {
          method: "POST",
          body: JSON.stringify({ assetID: asset.assetID, newExpiryDate: expiry.getValue() })
        });
        this._feedback("Software license renewed. CAP recalculated compliance immediately.", "Success");
        await this._reloadSelectionAndList();
        return true;
      });
      this.getView().addDependent(dialog);
      dialog.open();
    },

    onMaintenance: function () {
      var asset = this._page().getProperty("/selected");
      if (!asset) { return; }
      var reason = new TextArea({ rows: 3, maxLength: 500, growing: true, growingMaxLines: 6 });
      var fields = { reason: reason, content: this._labelControl("Maintenance reason", reason, true) };
      var dialog = this._formDialog("Place asset in maintenance", fields, "Confirm", async function () {
        var value = reason.getValue().trim();
        if (!value) {
          this._feedback("Enter a maintenance reason.", "Warning");
          return false;
        }
        return await this._runLifecycleAction("placeInMaintenance", { assetID: asset.assetID, reason: value }, "Asset moved to In Maintenance.");
      });
      this.getView().addDependent(dialog);
      dialog.open();
    },

    onReleaseMaintenance: async function () {
      var asset = this._page().getProperty("/selected");
      if (asset) {
        await this._runLifecycleAction("releaseFromMaintenance", { assetID: asset.assetID }, "Maintenance completed. Asset is Available again.");
      }
    },

    onRetire: function () {
      var asset = this._page().getProperty("/selected");
      if (!asset) { return; }
      var reason = new TextArea({ rows: 3, maxLength: 500, growing: true, growingMaxLines: 6 });
      var fields = {
        reason: reason,
        content: [
          new Text({ text: "An allocated asset must be returned before retirement. Past allocation history will be preserved." }).addStyleClass("dialogHelp"),
          this._labelControl("Retirement / disposal reason", reason, true)
        ]
      };
      var dialog = this._formDialog("Retire " + asset.assetName, fields, "Retire asset", async function () {
        var value = reason.getValue().trim();
        if (!value) {
          this._feedback("Enter a retirement or disposal reason.", "Warning");
          return false;
        }
        return await this._runLifecycleAction("retireAsset", { assetID: asset.assetID, reason: value }, "Asset retired. Its allocation history remains preserved.");
      }, { contentWidth: "34rem" });
      this.getView().addDependent(dialog);
      dialog.open();
    },

    onDeleteAsset: function () {
      var generation = this._sessionGeneration;
      var asset = this._page().getProperty("/selected");
      if (!asset) { return; }
      MessageBox.confirm("Permanently delete this asset only if CAP confirms it has no allocation history? This cannot be undone.", {
        title: "Delete asset record",
        actions: [MessageBox.Action.DELETE, MessageBox.Action.CANCEL],
        emphasizedAction: MessageBox.Action.DELETE,
        onClose: async function (action) {
          if (action !== MessageBox.Action.DELETE || !this._isCurrentSession(generation)) { return; }
          try {
            await this._request(this._entityPath("Assets", asset.assetID), { method: "DELETE" });
            this._assertCurrentSession(generation);
            this._selectedAssetId = "";
            this._set("selected", null);
            this._set("hasSelection", false);
            this._set("history", []);
            this._feedback("Asset record deleted.", "Success");
            await this._refreshAfterMutation(false);
          } catch (error) {
            this._reportFailure(error, "Asset was not deleted.");
          }
        }.bind(this)
      });
    },

    _runLifecycleAction: async function (operation, payload, successText) {
      var generation = this._sessionGeneration;
      this._setBusy(true, "Updating asset lifecycle…");
      try {
        await this._request(operation, { method: "POST", body: JSON.stringify(payload) });
        this._assertCurrentSession(generation);
        this._feedback(successText, "Success");
        await this._refreshAfterMutation();
        this._assertCurrentSession(generation);
        return true;
      } catch (error) {
        this._reportFailure(error, "CAP rejected the lifecycle change.");
        return false;
      } finally {
        this._setBusy(false, "", generation);
      }
    },

    _reloadSelectionAndList: async function () {
      var generation = this._sessionGeneration;
      var id = this._selectedAssetId;
      try {
        await this._loadAssets(true);
        this._assertCurrentSession(generation);
      } catch (error) {
        this._assertCurrentSession(generation);
        this._reportFailure(error, "The change succeeded, but the inventory refresh failed.");
        return false;
      }
      if (id && this._selectedAssetId === id) {
        var collection = this._page().getProperty("/activeSection") === "myAssets" ? "MyAssets" : "Assets";
        try {
          var payload = await this._request(this._entityPath(collection, id));
          this._assertCurrentSession(generation);
          var updated = unwrap(payload);
          if (updated && updated.assetID) {
            this._set("selected", updated);
            this._set("selectedStatus", updated.status || "Status not reported");
            this._set("selectedStatusState", this._statusState(updated.status));
            this._set("detailComplianceText", firstDefined(updated.complianceLabel, updated.complianceStatus, ""));
            this._set("detailComplianceVisible", !!firstDefined(updated.complianceLabel, updated.complianceStatus, ""));
            this._updateActionVisibility(updated);
          }
        } catch (error) {
          this._assertCurrentSession(generation);
          Log.warning("Selected asset readback was unavailable after the successful action: " + error.message, "", "it.asset.lifecycle.controller.App");
        }
      }
      return true;
    },

    _refreshAfterMutation: async function (preserveSelection) {
      var generation = this._sessionGeneration;
      try {
        var section = this._page().getProperty("/activeSection");
        if (section === "compliance") {
          await this._loadCompliance();
        } else if (preserveSelection === false) {
          await this._loadAssets(false);
        } else {
          await this._reloadSelectionAndList();
        }
        this._assertCurrentSession(generation);
        if (section !== "compliance" && this._page().getProperty("/canCompliance")) {
          await this._loadCompliance();
        }
        this._assertCurrentSession(generation);
        return true;
      } catch (error) {
        this._assertCurrentSession(generation);
        this._reportFailure(error, "The change succeeded, but its readback could not be refreshed.");
        return false;
      }
    },

    _entityPath: function (collection, id) {
      return collection + "(" + id + ")";
    },

  });

  function groupsafeLabel(index) {
    return ["Expired license", "Expiring soon", "Hardware warranty alert", "Idle asset", "Missing date"][index] || "Compliance alert";
  }
});
