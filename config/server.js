/*
 Server side script for creating archives
*/

const { casync } = require('./casync.js');
const { loadJSON, saveJSON } = require('./json.js');
const fs = require('fs');

// Get config file path from passed argument
if (process.argv.length > 2) {
    run(process.argv[2]);
}

/**
 * Run casync make according to configuration stored in the file as per passed configPath
 * @param {string} configPath 
 */
function run(configPath) {
    // Load configuration data passed via the first argument
    loadJSON(configPath).then(async (config) => {
        // check if configuration is an array
        if (Array.isArray(config)) {
            config.forEach(c => {
                processEntry(c);
            });
        }
        else {
            processEntry(config);
        }
    }).catch(err => {
        console.error(err);
        process.exit(1);
    });
}

/**
 * Process a configuration entry
 * @param {Object} config 
 */
async function processEntry(config) {
    // validate configuration file data
    if (config && config.index && config.store && config.source) {
        let options = [
            { store: config.store },
            { with: '2sec-time' },
        ];

        // Create or update the archive
        casync.make(config.index, config.source, options).then(digestData => {
            console.log(`Created archive - checksum: ${digestData.checksum}; timestamp: ${digestData.timestamp}`);
        }).catch(err => {
            console.error(`Unable to create archive: ${err}`);
            process.exit(1);
        });
    }
}