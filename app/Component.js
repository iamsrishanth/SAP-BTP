sap.ui.define([
  "sap/ui/core/UIComponent",
  "sap/ui/model/json/JSONModel"
], function (UIComponent, JSONModel) {
  "use strict";

  return UIComponent.extend("it.asset.lifecycle.Component", {
    metadata: {
      manifest: "json"
    },

    init: function () {
      UIComponent.prototype.init.apply(this, arguments);

      var pageModel = new JSONModel({
        connected: false,
        busy: false,
        busyText: "Loading…",
        role: "",
        userId: "",
        roleLabel: "",
        authenticationMode: "",
        demoProfilesAvailable: false,
        activeDemoProfile: "sap",
        demoOperatorUserId: "",
        demoProfileLabel: "SAP identity",
        demoProfileDescription: "",
        hasBusinessRole: false,
        businessToday: "",
        timeZone: "",
        activeSection: "inventory",
        query: "",
        filterStatus: "",
        filterType: "",
        pageNumber: 1,
        pageSize: 25,
        totalCount: 0,
        items: [],
        history: [],
        historyLoaded: false,
        historyLoading: false,
        employees: [],
        complianceGroups: [],
        complianceIntro: "Software license compliance and hardware warranty coverage are shown separately. Lifecycle status remains independent of expiry alerts.",
        selected: null,
        selectedTitle: "Select an asset",
        selectedStatus: "",
        selectedStatusState: "None",
        canAdmin: false,
        canCompliance: false,
        isEmployee: false,
        hasMore: false,
        feedbackText: "",
        feedbackType: "Information",
        feedbackVisible: false,
        loginError: "",
        loginErrorVisible: false,
        inventoryVisible: false,
        myAssetsVisible: false,
        complianceVisible: false,
        detailVisible: false,
        mobileDetail: false,
        loginVisible: true
      });
      this.setModel(pageModel, "page");

      this.setModel(new JSONModel({
        username: "",
        password: ""
      }), "login");
    }
  });
});
