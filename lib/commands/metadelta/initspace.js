import { Command } from '@oclif/core';
import fs from 'node:fs';
import path from 'node:path';
const REQUIRED_DIRECTORIES = [
    path.join('force-app', 'main', 'default'),
    'docs',
    'data',
    'manifest',
    'scripts'
];
const GITIGNORE_CONTENT = `# Gitignore Template Metadelta
*.properties
vlocity-temp/
*.sh

# Manejo interno
compare/
config/
__pycache__/
# LWC VSCode autocomplete
**/lwc/jsconfig.json

# LWC Jest coverage reports
coverage/

# Logs
logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Dependency directories
node_modules/

# Eslint cache
.eslintcache

# MacOS system files
.DS_Store

# Windows system files
Thumbs.db
ehthumbs.db
[Dd]esktop.ini
$RECYCLE.BIN/

# Local environment variables
.env
.vscode
.sf
.sfdx

# Other files
package-lock.json
.vscode/settings.json
pmd-*

# devops tools
*.py
*.cjs
.cache/
config/user/
tmp/
**/__tests__/**
**/cleanDataServices/
**/siteDotComSites/*.site
**/data/**/source/**
**/data/**/target/**
`;
const SFDX_PROJECT_CONTENT = `{
  "packageDirectories": [
    {
      "path": "force-app",
      "default": true
    }
  ],
  "name": "Salesforce Project",
  "namespace": "",
  "sfdcLoginUrl": "https://login.salesforce.com",
  "sourceApiVersion": "66.0"
}
`;
const PACKAGE_XML_CONTENT = `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <version>66.0</version>
</Package>
`;
class Initspace extends Command {
    static id = 'metadelta:initspace';
    static summary = 'Initialize a Salesforce project workspace scaffold in the current directory.';
    static description = 'Creates the standard Metadelta folder structure and base files (.gitignore, sfdx-project.json, package.xml) in the current directory.';
    async run() {
        const rootDirectory = process.cwd();
        for (const directory of REQUIRED_DIRECTORIES) {
            fs.mkdirSync(path.join(rootDirectory, directory), { recursive: true });
        }
        const filesToWrite = [
            { name: '.gitignore', content: GITIGNORE_CONTENT },
            { name: 'sfdx-project.json', content: SFDX_PROJECT_CONTENT },
            { name: 'package.xml', content: PACKAGE_XML_CONTENT }
        ];
        for (const file of filesToWrite) {
            fs.writeFileSync(path.join(rootDirectory, file.name), file.content, 'utf8');
        }
        this.log('✅ Workspace initialized successfully.');
        this.log('Created directories:');
        for (const directory of REQUIRED_DIRECTORIES) {
            this.log(`  - ${directory}`);
        }
        this.log('Created files: .gitignore, sfdx-project.json, package.xml');
    }
}
export default Initspace;
