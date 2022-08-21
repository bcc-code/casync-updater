/*
JSON file handling
*/

const fs = require('fs');

/**
 * Loads a JSON file from the passed path
 * @param {string} path 
 * @returns - Promise with configuration
 */
 function loadJSON(path) {
    return new Promise((resolve, reject) => {
        fs.readFile(path, (err, data) => {
            if (err) {
                reject(err);
            }
            else {
                try {
                    let c = JSON.parse(data);
                    resolve(c);
                }
                catch (err) {
                    reject(err);
                }
            }
        });
    });
}

/**
 * Save a JSON file to the passed path
 * @param {string} path 
 * @param {object} data
 * @returns - Promise when operation is complete
 */
function saveJSON(path, data) {
    return new Promise((resolve, reject) => {
        fs.writeFile(path, JSON.stringify(data), (err) => {
            if (err) {
                reject(err);
            }
            else {
                resolve();
            }
        });
    });
}

module.exports.loadJSON = loadJSON;
module.exports.saveJSON = saveJSON;