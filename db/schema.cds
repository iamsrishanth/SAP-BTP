namespace it.asset.lifecycle;

using { managed } from '@sap/cds/common';

/** A purchased hardware item or software license. */
entity Asset : managed {
  key assetID            : UUID;
      assetName          : String(200) not null;
      type               : String(20) not null;
      purchaseDate       : Date not null;
      expiryDate         : Date;
      status             : String(30) not null default 'Available';
      allocatedTo        : String(200);

  // Supporting lifecycle and identity fields. allocatedTo remains the required display value;
  // authorization always uses allocatedToUserId and the authenticated CAP principal.
      allocatedToUserId  : String(255);
      maintenanceReason  : String(500);
      retiredAt          : Timestamp;
      retirementReason   : String(500);
}

/** Immutable assignment snapshots; only returnedDate may be set once by returnAsset. */
entity AllocationHistory : managed {
  key allocID        : UUID;
      assetID        : Association to Asset not null;
      employeeName   : String(200) not null;
      employeeUserId : String(255) not null;
      assignedDate   : Date not null;
      returnedDate   : Date;
}

/** Trusted mapping between authenticated CAP subjects and employee display names. */
entity Employee : managed {
  key userId      : String(255);
      displayName : String(200) not null;
      active      : Boolean not null default true;
}
