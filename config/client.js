/*
Client service for periodic casync updates
*/

const { loadJSON, saveJSON } = require("./json.js");
const fs = require('fs');
const path = require('path');
const { casync } = require('./casync.js');
const { exec, execSync } = require('child_process');

/**
 * Checksum cache
 */
var checksum = {};

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

                // Get destination checksum
                await casync.digest(c.dstPath, dstOptions).then(data => {
                    checksum[c.dstPath] = data;
                    // console.log(`Found checksum for destination ${c.dstPath}`);
                }).catch(err => {
                    console.error(`Unable to find checksum for destination ${c.dstPath}: ${err}`)
                });

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
    // Get the source checksum
    let sourceChecksum;
    await casync.digest(srcIndex, srcOptions).then(data => {
        sourceChecksum = data.trim();
        // console.log(`Found checksum for source ${srcIndex}`);
    }).catch(err => {
        console.log(`Source index not available: ${srcIndex}`);
    });

    // Get the backup checksum
    let backupChecksum;
    if (backupIndex && backupOptions) {
        await casync.digest(backupIndex, backupOptions).then(data => {
            backupChecksum = data.trim();
            // console.log(`Found checksum for backup: ${backupIndex}`);
        }).catch(err => {
            console.log(`Backup index not available: ${backupIndex}`);
        });
    }

    // Check if source checksum changed (or first run)
    if (sourceChecksum && sourceChecksum !== checksum[dstPath]) {
        // Get changed files / directories (used for triggers)
        let diff;
        await casync.diff(srcIndex, srcOptions, dstPath, dstOptions).then(data => {
            diff = data;
        }).catch(err => {
            console.error(`Failed to detect differences between ${srcIndex} and ${dstPath}: ${err}`);
        });

        // Exctract source and update cached checksum
        await extract(srcIndex, srcOptions, dstPath, dstOptions).then(data => {
            if (data) {
                checksum[dstPath] = data;
                console.log(`Extracted source from ${srcIndex} to ${dstPath}`);
            }
            else {
                console.log(`Failed to extract source from ${srcIndex} to ${dstPath}`);
            }
        }).catch(err => {
            console.error(`Failed to extract source from ${srcIndex} to ${dstPath}: ${err}`);
            delete checksum[dstPath];
        });

        // Execute triggers
        execTriggers(diff, triggers);
    }
    // If the source is not available, try to extract from backup source
    else if (!sourceChecksum && backupChecksum && checksum[dstPath] &&
        checksum[dstPath] !== backupChecksum) {
        await extractBackup(backupIndex, backupOptions, dstPath, dstOptions).then(data => {
            if (data) {
                checksum[dstPath] = data
                console.log(`Extracted backup from ${backupIndex} to ${dstPath}`);
            }
            else {
                console.error(`Failed to extract backup from ${backupIndex} to ${dstPath}`);
            };
        }).catch(err => {
            console.error(`Failed to extract backup from ${backupIndex} to ${dstPath}: ${err}`);
            delete checksum[dstPath];
        });
    }

    // check if backup checksum is outdated (or first run)
    if (backupIndex && checksum[dstPath] && backupChecksum !== checksum[dstPath]) {
        // Make backup archive
        await makeBackup(dstPath, backupIndex, backupOptions).then(data => {
            console.log(`Saved backup from ${dstPath} to ${backupIndex}`);
        }).catch(err => {
            console.log(`Unable to save backup from ${dstPath} to ${backupIndex}: ${err}`);
        });
    }
}

/**
 * Check if a directory exists
 * @param {string} path 
 * @returns - true if the directory exists
 */
function dirExists(path) {
    let p = path;
    if (!p.endsWith('/')) { p += '/' }

    return fs.existsSync(p);
}

/**
 * Determine whether the given `path` points to an empty directory.
 * @param {string} path 
 * @returns {Boolean}
 */
function isEmptyDir(path) {
    try {
        let files = fs.readdirSync(path);
        if (files.length > 0) {
            return false;
        }
        else {
            return true;
        }
    } catch (error) {
        return true;
    }
}

/**
 * Extract from a casync source to a local directory
 * @param {string} srcIndex 
 * @param {Object} srcOptions
 * @param {path} dstPath 
 * @param {object} options 
 * @returns Promise with the checksum if the operation was successful
 */
function extract(srcIndex, srcOptions, dstPath, dstOptions) {
    return new Promise((resolve, reject) => {
        // Check for valid destination
        if (dirExists(dstPath)) {
            casync.extract(srcIndex, dstPath, srcOptions).then(() => {
                casync.digest(dstPath, dstOptions).then(checksum => {
                    resolve(checksum)
                }).catch(err => {
                    reject(err);
                });
            }).catch(err => {
                reject(err);
            });
        }
        else {
            reject(`Destination directory ${dstPath} does not exist.`);
        }
    });
}

/**
 * Makes a backup of a local directory to a local casync destination
 * @param {String} srcPath - Source directory path
 * @param {String} dstIndex - Destination index file path
 * @param {Object} dstOptions - Destination options
 * @returns Promise with the checksum if the operation was successful
 */
function makeBackup(srcPath, dstIndex, dstOptions) {
    return new Promise((resolve, reject) => {
        let dstDir = path.dirname(dstIndex);
        let srcExist = dirExists(srcPath);
        let srcEmpty = false;
        if (srcExist) { srcEmpty = isEmptyDir(srcPath) }
        let dstExist = dirExists(dstDir);

        // Check for valid index and source
        if (srcExist && !srcEmpty && dstExist) {
            casync.make(dstIndex, srcPath, dstOptions).then(checksum => {
                resolve(checksum);
            }).catch(err => {
                reject(err);
            });
        }
        else {
            let msg = '';
            if (!srcExist) { msg += `Source directory ${srcPath} does not exist; ` }
            else if (srcEmpty) { msg += `Source directory ${srcPath} is empty; ` }
            if (!dstExist) { msg += `Destination directory ${dstDir} does not exist; ` }
            reject(msg);
        }
    });
}

/**
 * Extract a backup from a local casync source to a local directory
 * @param {String} backupIndex 
 * @param {Object} backupOptions 
 * @param {String} dstPath 
 * @param {Object} dstOptions
 * @returns Promise with the checksum if the operation was successful
 */
function extractBackup(backupIndex, backupOptions, dstPath, dstOptions) {
    return new Promise((resolve, reject) => {
        // Check for valid data and valid destination
        if (dirExists(dstPath) && fs.existsSync(backupIndex)) {
            casync.extract(backupIndex, dstPath, backupOptions).then(() => {
                casync.digest(dstPath, dstOptions).then(checksum => {
                    resolve(checksum)
                }).catch(err => {
                    reject(err);
                });
            });
        }
        else {
            reject(`Directory ${dstPath} or ${backupIndex} does not exist.`);
        }
    });
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