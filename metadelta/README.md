metadelta
=================

A new CLI generated with oclif


[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Version](https://img.shields.io/npm/v/metadelta.svg)](https://npmjs.org/package/metadelta)
[![Downloads/week](https://img.shields.io/npm/dw/metadelta.svg)](https://npmjs.org/package/metadelta)


<!-- toc -->
* [Usage](#usage)
* [Commands](#commands)
<!-- tocstop -->
# Usage
<!-- usage -->
```sh-session
$ npm install -g metadelta
$ metadelta COMMAND
running command...
$ metadelta (--version)
metadelta/0.0.0 linux-x64 node-v18.19.1
$ metadelta --help [COMMAND]
USAGE
  $ metadelta COMMAND
...
```
<!-- usagestop -->
# Commands
<!-- commands -->
* [`metadelta hello PERSON`](#metadelta-hello-person)
* [`metadelta hello world`](#metadelta-hello-world)
* [`metadelta help [COMMAND]`](#metadelta-help-command)
* [`metadelta plugins`](#metadelta-plugins)
* [`metadelta plugins add PLUGIN`](#metadelta-plugins-add-plugin)
* [`metadelta plugins:inspect PLUGIN...`](#metadelta-pluginsinspect-plugin)
* [`metadelta plugins install PLUGIN`](#metadelta-plugins-install-plugin)
* [`metadelta plugins link PATH`](#metadelta-plugins-link-path)
* [`metadelta plugins remove [PLUGIN]`](#metadelta-plugins-remove-plugin)
* [`metadelta plugins reset`](#metadelta-plugins-reset)
* [`metadelta plugins uninstall [PLUGIN]`](#metadelta-plugins-uninstall-plugin)
* [`metadelta plugins unlink [PLUGIN]`](#metadelta-plugins-unlink-plugin)
* [`metadelta plugins update`](#metadelta-plugins-update)

## `metadelta hello PERSON`

Say hello

```
USAGE
  $ metadelta hello PERSON -f <value>

ARGUMENTS
  PERSON  Person to say hello to

FLAGS
  -f, --from=<value>  (required) Who is saying hello

DESCRIPTION
  Say hello

EXAMPLES
  $ metadelta hello friend --from oclif
  hello friend from oclif! (./src/commands/hello/index.ts)
```

_See code: [src/commands/hello/index.ts](https://github.com/app/metadelta/blob/v0.0.0/src/commands/hello/index.ts)_

## `metadelta hello world`

Say hello world

```
USAGE
  $ metadelta hello world

DESCRIPTION
  Say hello world

EXAMPLES
  $ metadelta hello world
  hello world! (./src/commands/hello/world.ts)
```

_See code: [src/commands/hello/world.ts](https://github.com/app/metadelta/blob/v0.0.0/src/commands/hello/world.ts)_

## `metadelta help [COMMAND]`

Display help for metadelta.

```
USAGE
  $ metadelta help [COMMAND...] [-n]

ARGUMENTS
  COMMAND...  Command to show help for.

FLAGS
  -n, --nested-commands  Include all nested commands in the output.

DESCRIPTION
  Display help for metadelta.
```

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/v6.2.28/src/commands/help.ts)_

## `metadelta plugins`

List installed plugins.

```
USAGE
  $ metadelta plugins [--json] [--core]

FLAGS
  --core  Show core plugins.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List installed plugins.

EXAMPLES
  $ metadelta plugins
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.38/src/commands/plugins/index.ts)_

## `metadelta plugins add PLUGIN`

Installs a plugin into metadelta.

```
USAGE
  $ metadelta plugins add PLUGIN... [--json] [-f] [-h] [-s | -v]

ARGUMENTS
  PLUGIN...  Plugin to install.

FLAGS
  -f, --force    Force npm to fetch remote resources even if a local copy exists on disk.
  -h, --help     Show CLI help.
  -s, --silent   Silences npm output.
  -v, --verbose  Show verbose npm output.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Installs a plugin into metadelta.

  Uses npm to install plugins.

  Installation of a user-installed plugin will override a core plugin.

  Use the METADELTA_NPM_LOG_LEVEL environment variable to set the npm loglevel.
  Use the METADELTA_NPM_REGISTRY environment variable to set the npm registry.

ALIASES
  $ metadelta plugins add

EXAMPLES
  Install a plugin from npm registry.

    $ metadelta plugins add myplugin

  Install a plugin from a github url.

    $ metadelta plugins add https://github.com/someuser/someplugin

  Install a plugin from a github slug.

    $ metadelta plugins add someuser/someplugin
```

## `metadelta plugins:inspect PLUGIN...`

Displays installation properties of a plugin.

```
USAGE
  $ metadelta plugins inspect PLUGIN...

ARGUMENTS
  PLUGIN...  [default: .] Plugin to inspect.

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Displays installation properties of a plugin.

EXAMPLES
  $ metadelta plugins inspect myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.38/src/commands/plugins/inspect.ts)_

## `metadelta plugins install PLUGIN`

Installs a plugin into metadelta.

```
USAGE
  $ metadelta plugins install PLUGIN... [--json] [-f] [-h] [-s | -v]

ARGUMENTS
  PLUGIN...  Plugin to install.

FLAGS
  -f, --force    Force npm to fetch remote resources even if a local copy exists on disk.
  -h, --help     Show CLI help.
  -s, --silent   Silences npm output.
  -v, --verbose  Show verbose npm output.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Installs a plugin into metadelta.

  Uses npm to install plugins.

  Installation of a user-installed plugin will override a core plugin.

  Use the METADELTA_NPM_LOG_LEVEL environment variable to set the npm loglevel.
  Use the METADELTA_NPM_REGISTRY environment variable to set the npm registry.

ALIASES
  $ metadelta plugins add

EXAMPLES
  Install a plugin from npm registry.

    $ metadelta plugins install myplugin

  Install a plugin from a github url.

    $ metadelta plugins install https://github.com/someuser/someplugin

  Install a plugin from a github slug.

    $ metadelta plugins install someuser/someplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.38/src/commands/plugins/install.ts)_

## `metadelta plugins link PATH`

Links a plugin into the CLI for development.

```
USAGE
  $ metadelta plugins link PATH [-h] [--install] [-v]

ARGUMENTS
  PATH  [default: .] path to plugin

FLAGS
  -h, --help          Show CLI help.
  -v, --verbose
      --[no-]install  Install dependencies after linking the plugin.

DESCRIPTION
  Links a plugin into the CLI for development.

  Installation of a linked plugin will override a user-installed or core plugin.

  e.g. If you have a user-installed or core plugin that has a 'hello' command, installing a linked plugin with a 'hello'
  command will override the user-installed or core plugin implementation. This is useful for development work.


EXAMPLES
  $ metadelta plugins link myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.38/src/commands/plugins/link.ts)_

## `metadelta plugins remove [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ metadelta plugins remove [PLUGIN...] [-h] [-v]

ARGUMENTS
  PLUGIN...  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ metadelta plugins unlink
  $ metadelta plugins remove

EXAMPLES
  $ metadelta plugins remove myplugin
```

## `metadelta plugins reset`

Remove all user-installed and linked plugins.

```
USAGE
  $ metadelta plugins reset [--hard] [--reinstall]

FLAGS
  --hard       Delete node_modules and package manager related files in addition to uninstalling plugins.
  --reinstall  Reinstall all plugins after uninstalling.
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.38/src/commands/plugins/reset.ts)_

## `metadelta plugins uninstall [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ metadelta plugins uninstall [PLUGIN...] [-h] [-v]

ARGUMENTS
  PLUGIN...  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ metadelta plugins unlink
  $ metadelta plugins remove

EXAMPLES
  $ metadelta plugins uninstall myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.38/src/commands/plugins/uninstall.ts)_

## `metadelta plugins unlink [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ metadelta plugins unlink [PLUGIN...] [-h] [-v]

ARGUMENTS
  PLUGIN...  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ metadelta plugins unlink
  $ metadelta plugins remove

EXAMPLES
  $ metadelta plugins unlink myplugin
```

## `metadelta plugins update`

Update installed plugins.

```
USAGE
  $ metadelta plugins update [-h] [-v]

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Update installed plugins.
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.38/src/commands/plugins/update.ts)_
<!-- commandsstop -->
