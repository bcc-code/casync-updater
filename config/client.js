/*
Client service for periodic casync updates
*/

const { loadJSON, saveJSON } = require("./json.js");
const fs = require('fs');
const path = require('path');
const { casync } = require('./casync.js');
const { exec, execSync } = require('child_process');

/**
 * Trigger actions cache
 */
var tActions = {};

setTimeout(() => {
// Load config and make casync archive
if (process.argv.length > 2) {
    let path = process.argv[2];
    // Check if the passed path is a directory or file
    try {
        if (fs.lstatSync(path).isDirectory()) {
            let files = fs.readdirSync(path);
            files.forEach(file => {
                loadFile(path + '/' + file);
            });
        }
        else if (fs.lstatSync(path).isFile()) {
            loadFile(path);
        }
    }
    catch (err) {
        console.error(`Error reading configuration file or directory ${path}}: ${err}`);
    }
}
}, 1000);


/**
 * Load a configuration file and parse the config
 * @param {String} path 
 */
function loadFile(path) {
    loadJSON(path).then(config => {
        parseConfig(config);
    }).catch(err => {
        console.error(`Error in ${path}: ${err}`);
    });
}

/**
 * Parse a configuration object, and schedule updaters
 * @param {object} config 
 */
function parseConfig(config) {
    if (Array.isArray(config)) {
        config.forEach(async c => {
            // Check for valid configuration entry
            if (c.interval && c.srcIndex && c.srcStore && c.dstPath) {
                let srcOptions = [
                    { store: c.srcStore },
                    { with: '2sec-time' },  // This option seems to ignore user details
                ];

                let dstOptions = [
                    { with: '2sec-time' },
                ];

                let backupOptions = [
                    { store: c.backupStore },
                    { with: '2sec-time' },
                ];

                // First run
                await runCycle(c.srcIndex, srcOptions, c.backupIndex, backupOptions, c.dstPath, dstOptions, c.triggers);

                // Execute startup actions
                execStartup(c.startup);

                // Start the interval timer
                setInterval(async () => {
                    runCycle(c.srcIndex, srcOptions, c.backupIndex, backupOptions, c.dstPath, dstOptions, c.triggers);
                }, c.interval);
            }
            else {
                throw Error(`Invalid configuration: ${JSON.stringify(c)}`);
            }
        });
    }
    else {
        throw Error('Invalid configuration');
    }
}

/**
 * Run a casync cycle
 * @param {*} srcIndex 
 * @param {*} srcOptions 
 * @param {*} backupIndex 
 * @param {*} backupOptions 
 * @param {*} dstPath
 * @param {*} dstOptions 
 * @param {*} triggers
 */
async function runCycle(srcIndex, srcOptions, backupIndex, backupOptions, dstPath, dstOptions, triggers) {
    // Destination checksum cache path
    let dstDirName = dstPath.match(/\/[^/]*$/g).replace(/\//g,'');
    let dstCksPath = path.join(dstPath + '/../' + dstDirName + '.cks');

    // Get the source checksum
    let srcChecksum;
    await casync.digest(srcIndex, srcOptions).then(data => {
        srcChecksum = data;
    }).catch(err => {
        console.log(`Source index not available: ${srcIndex}`);
    });

    // Get the backup checksum
    let backupChecksum;
    if (backupIndex && backupOptions) {
        await casync.digest(backupIndex, backupOptions).then(data => {
            backupChecksum = data;
        }).catch(err => {
            console.log(`Backup index not available: ${backupIndex}`);
        });
    }

    // Get the destination directory checksum
    let dstChecksum;
    await casync.digest(dstPath, dstOptions, dstCksPath).then(data => {
        dstChecksum = data;
    }).catch(err => {
        console.log(`Destination not available: ${dstPath}`);
    });

    // Check if source checksum changed
    if (srcChecksum && dstChecksum && srcChecksum.checksum !== dstChecksum.checksum && srcChecksum.timestamp > dstChecksum.timestamp || !dstChecksum.timestamp) {
        // Get changed files / directories (used for triggers)
        let diff;
        await casync.diff(srcIndex, srcOptions, dstPath, dstOptions).then(data => {
            diff = data;
        }).catch(err => {
            console.error(`Failed to detect differences between ${srcIndex} and ${dstPath}: ${err}`);
        });

        // Exctract source and update cached checksum
        await casync.extract(srcIndex, srcOptions, dstPath, dstCksPath).then(data => {
            if (data) {
                console.log(`Extracted source from ${srcIndex} to ${dstPath}`);
            }
            else {
                console.log(`Failed to extract source from ${srcIndex} to ${dstPath}`);
            }
        }).catch(err => {
            console.error(`Failed to extract source from ${srcIndex} to ${dstPath}: ${err}`);
        });

        // Execute triggers
        execTriggers(diff, triggers);
    }
    // If the source is not available, try to extract from backup source
    else if (!srcChecksum && backupIndex && srcChecksum && backupChecksum && backupChecksum.checksum !== srcChecksum.checksum && backupChecksum.timestamp > srcChecksum.timestamp || !srcChecksum.timestamp) {
        await casync.extract(backupIndex, backupOptions, dstPath, dstCksPath).then(data => {
            if (data) {
                console.log(`Extracted backup from ${backupIndex} to ${dstPath}`);
            }
            else {
                console.error(`Failed to extract backup from ${backupIndex} to ${dstPath}`);
            };
        }).catch(err => {
            console.error(`Failed to extract backup from ${backupIndex} to ${dstPath}: ${err}`);
        });
    }

    // check if backup checksum is outdated
    if (backupIndex && dstChecksum && backupChecksum && backupChecksum.checksum !== dstChecksum.checksum && dstChecksum.timestamp > backupChecksum.timestamp || !backupChecksum.timestamp) {
        // Make backup archive
        await casync.make(backupIndex, dstPath, backupOptions, dstCksPath).then(data => {
            console.log(`Saved backup from ${dstPath} to ${backupIndex}`);
        }).catch(err => {
            console.log(`Unable to save backup from ${dstPath} to ${backupIndex}: ${err}`);
        });
    }
}

/**
 * Execute triggers
 * @param {Object} diff 
 * @param {Object} triggers 
 */
function execTriggers(diff, triggers) {
    if (diff && triggers) {
        triggers.forEach(trigger => {
            if (trigger.paths && trigger.actions && Array.isArray(trigger.paths) && Array.isArray(trigger.actions) && trigger.paths.length > 0 && trigger.actions.length > 0) {
                // Find match
                let match = false;
                let i = 0;
                while (i < trigger.paths.length && !match) {
                    found = diff.includes(trigger.paths[i]);
                    i++;
                }

                // Execute triggers
                trigger.actions.forEach(action => {
                    try {
                        // Add action to trigger actions cache to prevent re-running the trigger if also called from the startup actions
                        tActions[action] = true;
                        console.log(`Executing trigger action: "${action}"`);
                        let output = execSync(action, { shell: '/bin/bash' });
                        console.log(output.toString());
                    }
                    catch (err) {
                        console.error(`Unable to process trigger action "${action}": ${err.message}`);
                    }
                });
            }
        });
    }
}

/**
 * Execute list of startup commands
 * @param {Array} startup 
 */
function execStartup(startup) {
    if (startup && Array.isArray(startup)) {
        startup.forEach(action => {
            // Only run the startup action / command if the action has not already been triggered during the first cycle run.
            if (!tActions[action]) {
                try {
                    console.log(`Executing startup action: "${action}"`);
                    let output = execSync(action, { shell: '/bin/bash' });
                    console.log(output.toString());
                }
                catch (err) {
                    console.error(`Unable to process startup action "${action}": ${err.message}`);
                }
            }
        });
    }
}