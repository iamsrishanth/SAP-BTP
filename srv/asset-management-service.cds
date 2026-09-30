using { it.asset.lifecycle as db } from '../db/schema';

@path: 'asset-management'
@requires: 'authenticated-user'
service AssetManagementService {

  @restrict: [
    { grant: 'READ',   to: 'ITAdmin' },
    { grant: 'CREATE', to: 'ITAdmin' },
    { grant: 'UPDATE', to: 'ITAdmin' },
    { grant: 'DELETE', to: 'ITAdmin' }
  ]
  @cds.search: { assetName, type, allocatedTo }
  @cds.redirection.target
  entity Assets as projection on db.Asset;

  @restrict: [{ grant: 'READ', to: 'ITAdmin' }]
  entity AllocationHistories as projection on db.AllocationHistory;

  @restrict: [{ grant: 'READ', to: 'ITAdmin' }]
  entity Employees as projection on db.Employee {
    key userId,
        displayName,
        active
  };

  @restrict: [{ grant: 'READ', to: 'Employee' }]
  @cds.redirection.target: false
  entity MyAssets as projection on db.Asset {
    key assetID,
        assetName,
        type,
        purchaseDate,
        expiryDate,
        status,
        allocatedTo
  };

  type ComplianceAlert : {
    assetID      : UUID;
    assetName    : String(200);
    type         : String(20);
    status       : String(30);
    expiryDate   : Date;
    alertType    : String(50);
    daysRemaining: Integer;
    idleSince    : Date;
    daysIdle     : Integer;
  };

  type ComplianceSummary : {
    businessToday        : Date;
    expiryWarningDays    : Integer;
    idleThresholdDays    : Integer;
    expiredLicenses      : many ComplianceAlert;
    expiringLicenses     : many ComplianceAlert;
    hardwareWarrantyAlerts : many ComplianceAlert;
    idleAssets           : many ComplianceAlert;
    missingDateAlerts    : many ComplianceAlert;
  };

  type SessionInfo : {
    userId       : String(255);
    roles        : many String;
    businessToday: Date;
    timeZone     : String(100);
  };

  @requires: 'ITAdmin'
  action provisionEmployee(userId: String(255), displayName: String(200)) returns Employees;

  @requires: 'ITAdmin'
  action allocateAsset(assetID: UUID, employeeUserId: String(255)) returns Assets;

  @requires: 'ITAdmin'
  action returnAsset(assetID: UUID) returns Assets;

  @requires: 'ITAdmin'
  action renewSoftwareLicense(assetID: UUID, newExpiryDate: Date) returns Assets;

  @requires: 'ITAdmin'
  action placeInMaintenance(assetID: UUID, reason: String(500)) returns Assets;

  @requires: 'ITAdmin'
  action releaseFromMaintenance(assetID: UUID) returns Assets;

  @requires: 'ITAdmin'
  action retireAsset(assetID: UUID, reason: String(500)) returns Assets;

  @requires: ['ITAdmin', 'ComplianceManager']
  function complianceAlerts() returns ComplianceSummary;

  function sessionInfo() returns SessionInfo;
}
