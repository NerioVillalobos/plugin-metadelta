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
    ['quickActions/Account.MyAction.quickAction-meta.xml', 'QuickAction', 'Account.MyAction'],
    ['remoteSiteSettings/MyRemote.remoteSite-meta.xml', 'RemoteSiteSetting', 'MyRemote'],
    ['settings/Security.settings-meta.xml', 'Settings', 'Security'],
    ['workflows/Account.workflow-meta.xml', 'Workflow', 'Account'],
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
