import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyChange} from '../src/utils/monitor/metadata.js';

test('classifyChange maps common Salesforce source folders to Metadata API types', () => {
  const cases = [
    ['flexipages/Home.flexipage-meta.xml', 'FlexiPage', 'Home'],
    ['triggers/AccountTrigger.trigger', 'ApexTrigger', 'AccountTrigger'],
    ['pages/MyPage.page', 'ApexPage', 'MyPage'],
    ['components/MyComponent.component', 'ApexComponent', 'MyComponent'],
    ['applications/MyApp.app-meta.xml', 'CustomApplication', 'MyApp'],
    ['tabs/MyTab.tab-meta.xml', 'CustomTab', 'MyTab'],
    ['staticresources/MyResource.resource-meta.xml', 'StaticResource', 'MyResource'],
    ['labels/CustomLabels.labels-meta.xml', 'CustomLabels', 'CustomLabels'],
    ['autoResponseRules/Lead.autoResponseRules-meta.xml', 'AutoResponseRules', 'Lead'],
    ['assignmentRules/Lead.assignmentRules-meta.xml', 'AssignmentRules', 'Lead'],
    ['brandingSets/MyBrand.brandingSet-meta.xml', 'BrandingSet', 'MyBrand'],
    ['callCenters/MyCallCenter.callCenter-meta.xml', 'CallCenter', 'MyCallCenter'],
    ['communities/MyCommunity.community-meta.xml', 'Community', 'MyCommunity'],
    ['connectedApps/MyApp.connectedApp-meta.xml', 'ConnectedApp', 'MyApp'],
    ['contentassets/Logo.asset-meta.xml', 'ContentAsset', 'Logo'],
    ['corsWhitelistOrigins/MyOrigin.corsWhitelistOrigin-meta.xml', 'CorsWhitelistOrigin', 'MyOrigin'],
    ['customMetadata/Setting.Value.md-meta.xml', 'CustomMetadata', 'Setting.Value'],
    ['customPermissions/MyPermission.customPermission-meta.xml', 'CustomPermission', 'MyPermission'],
    ['quickActions/Account.MyAction.quickAction-meta.xml', 'QuickAction', 'Account.MyAction'],
    ['remoteSiteSettings/MyRemote.remoteSite-meta.xml', 'RemoteSiteSetting', 'MyRemote'],
    ['settings/Security.settings-meta.xml', 'Settings', 'Security'],
    ['objectTranslations/Account-es.objectTranslation-meta.xml', 'CustomObjectTranslation', 'Account-es'],
    ['translations/es.translation-meta.xml', 'Translations', 'es'],
    ['standardValueSetTranslations/CaseStatus-es.standardValueSetTranslation-meta.xml', 'StandardValueSetTranslation', 'CaseStatus-es'],
    ['standardValueSets/CaseStatus.standardValueSet-meta.xml', 'StandardValueSet', 'CaseStatus'],
    ['dataSources/MySource.dataSource-meta.xml', 'ExternalDataSource', 'MySource'],
    ['escalationRules/Case.escalationRules-meta.xml', 'EscalationRules', 'Case'],
    ['experiences/Site1.site-meta.xml', 'ExperienceBundle', 'Site1'],
    ['globalValueSets/MySet.globalValueSet-meta.xml', 'GlobalValueSet', 'MySet'],
    ['homePageComponents/MyComponent.homePageComponent-meta.xml', 'HomePageComponent', 'MyComponent'],
    ['homePageLayouts/MyLayout.homePageLayout-meta.xml', 'HomePageLayout', 'MyLayout'],
    ['installedPackages/pkg.installedPackage-meta.xml', 'InstalledPackage', 'pkg'],
    ['letterhead/Classic.letter-meta.xml', 'Letterhead', 'Classic'],
    ['managedTopics/MyTopic.managedTopics-meta.xml', 'ManagedTopics', 'MyTopic'],
    ['messageChannels/MyChannel.messageChannel-meta.xml', 'LightningMessageChannel', 'MyChannel'],
    ['namedCredentials/MyNC.namedCredential-meta.xml', 'NamedCredential', 'MyNC'],
    ['notificationtypes/MyNotif.notificationType-meta.xml', 'CustomNotificationType', 'MyNotif'],
    ['pathAssistants/Lead.pathAssistant-meta.xml', 'PathAssistant', 'Lead'],
    ['permissionsetgroups/MyGroup.permissionsetgroup-meta.xml', 'PermissionSetGroup', 'MyGroup'],
    ['platformCachePartitions/MyPartition.platformCachePartition-meta.xml', 'PlatformCachePartition', 'MyPartition'],
    ['redirectWhitelistUrls/MyUrl.redirectWhitelistUrl-meta.xml', 'RedirectWhitelistUrl', 'MyUrl'],
    ['samlssoconfigs/MySso.samlssoconfig-meta.xml', 'SamlSsoConfig', 'MySso'],
    ['sharingRules/Account.sharingRules-meta.xml', 'SharingRules', 'Account'],
    ['sites/MySite.site-meta.xml', 'CustomSite', 'MySite'],
    ['territory2Models/Model.territory2Model-meta.xml', 'Territory2Model', 'Model'],
    ['weblinks/MyLink.weblink-meta.xml', 'CustomPageWebLink', 'MyLink'],
    ['workflows/Account.workflow-meta.xml', 'Workflow', 'Account'],
    ['roles/Sales.role-meta.xml', 'Role', 'Sales'],
    ['groups/MyGroup.group-meta.xml', 'Group', 'MyGroup'],
    ['queues/MyQueue.queue-meta.xml', 'Queue', 'MyQueue'],
    ['reportTypes/MyReportType.reportType-meta.xml', 'ReportType', 'MyReportType'],
    ['matchingRules/Account.matchingRule-meta.xml', 'MatchingRules', 'Account'],
    ['duplicateRules/Account.MyRule.duplicateRule-meta.xml', 'DuplicateRule', 'Account.MyRule'],
  ];

  for (const [relativePath, type, memberName] of cases) {
    const classified = classifyChange(`DEV/current/salesforce/force-app/main/default/${relativePath}`);

    assert.equal(classified.type, type, relativePath);
    assert.equal(classified.memberName, memberName, relativePath);
    assert.equal(classified.source, 'salesforce', relativePath);
  }
});

test('classifyChange preserves folder-based full names for nested metadata', () => {
  const cases = [
    ['reports/Sales/Monthly.report-meta.xml', 'Report', 'Sales/Monthly'],
    ['dashboards/Sales/Executive.dashboard-meta.xml', 'Dashboard', 'Sales/Executive'],
    ['email/unfiled$public/Welcome.email-meta.xml', 'EmailTemplate', 'unfiled$public/Welcome'],
    ['documents/Contracts/Terms.document-meta.xml', 'Document', 'Contracts/Terms'],
  ];

  for (const [relativePath, type, memberName] of cases) {
    const classified = classifyChange(`DEV/current/salesforce/force-app/main/default/${relativePath}`);

    assert.equal(classified.type, type, relativePath);
    assert.equal(classified.memberName, memberName, relativePath);
  }
});

test('classifyChange includes object name for object child metadata', () => {
  const cases = [
    ['objects/Account/fields/Segment__c.field-meta.xml', 'CustomField', 'Account.Segment__c'],
    ['objects/Account/validationRules/RequireSegment.validationRule-meta.xml', 'ValidationRule', 'Account.RequireSegment'],
    ['objects/Account/webLinks/Open.webLink-meta.xml', 'WebLink', 'Account.Open'],
    ['objects/Account/listViews/Recent.listView-meta.xml', 'ListView', 'Account.Recent'],
    ['objects/Account/compactLayouts/Compact.compactLayout-meta.xml', 'CompactLayout', 'Account.Compact'],
    ['objects/Account/recordTypes/Business.recordType-meta.xml', 'RecordType', 'Account.Business'],
  ];

  for (const [relativePath, type, memberName] of cases) {
    const classified = classifyChange(`DEV/current/salesforce/force-app/main/default/${relativePath}`);

    assert.equal(classified.type, type, relativePath);
    assert.equal(classified.memberName, memberName, relativePath);
  }
});

test('classifyChange treats Salesforce OmniStudio integration procedure files as Vlocity audit targets', () => {
  const classified = classifyChange(
    'DEV/current/salesforce/force-app/main/default/omniIntegrationProcedures/TC_ExternalServiceAssets.omniIntegrationProcedure-meta.xml'
  );

  assert.equal(classified.type, 'IntegrationProcedure');
  assert.equal(classified.source, 'vlocity');
  assert.equal(classified.memberName, 'TC_ExternalServiceAssets');
});
