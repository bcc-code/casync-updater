/**
 * Wrapper for casync
 */

const util = require('util');
const exec = util.promisify(require('child_process').exec);

/**
 * (Incomplete) nodejs wrapper for casync (see https://github.com/systemd/casync)
 */
class casync {
    /**
     * Creates a casync archive. For more information, see man casync.
     * @param {String} index - Index file name
     * @param {String} source - Path to directory or device
     * @param {Object} options - casync options in the following format: [ {option1: value}, {option2, value}, ... , {optionN: value} ] }. For more information, see man casync.
     * @returns - Promise when archive is created
     */
    static make(index, source, options) {
        return exec(`casync make ${this._optionString(options)} ${index} ${source}`);
    }

    /**
     * Extracts a casync archive. For more information, see man casync.
     * @param {string} index - Index file name
     * @param {string} destination - Path to directory or device
     * @param {Object} options - casync options in the following format: [ {option1: value}, {option2, value}, ... , {optionN: value} ] }. For more information, see man casync.
     * @returns - Promise when archive is extracted
     */
    static extract(index, destination, options) {
        return exec(`casync extract ${this._optionString(options)} ${index} ${destination}`);
    }

    /**
     * Calculates the checksum of the target archive (index file), directory or device. For more information, see man casync.
     * @param {String} target 
     * @param {Object} options - casync options in the following format: [ {option1: value}, {option2, value}, ... , {optionN: value} ] }. For more information, see man casync.
     * @returns - Promise containing the checksum
     */
    static digest(target, options) {
        return new Promise((resolve, reject) => {
            exec(`casync digest ${this._optionString(options)} ${target}`).then(data => {
                resolve(data.stdout.trim());
            }).catch(err => {
                reject(err);
            });
        });
    }

    /**
     * Removes chunks that are not used by the specified index. For more information, see man casync.
     * @param {String} index - Path to index file
     * @param {Object} options - casync options in the following format: [ {option1: value}, {option2, value}, ... , {optionN: value} ] }. For more information, see man casync.
     * @returns - Promise when the operation is complete
     */
    static gc(index) {
        return exec(`casync gc ${this._optionString(options)} ${index}`);
    }

    static _optionString(options) {
        try {
            let s = '';
            options.forEach(option => {
                s += '--' + Object.keys(option)[0] + '=' + Object.values(option)[0] + ' ';
            });
            return s;
        }
        catch {
            throw Error('Invalid options format');
        }
    }

    /**
     * Compares two casync sources (index, store or directory).
     * @param {String} source1 - Path to source 1 (index file, store file or directory)
     * @param {Object} options1 - casync options in the following format: [ {option1: value}, {option2, value}, ... , {optionN: value} ] }. For more information, see man casync.
     * @param {String} source2 - Path to source 2 (index file, store file or directory)
     * @param {Object} options2 - casync options in the following format: [ {option1: value}, {option2, value}, ... , {optionN: value} ] }. For more information, see man casync.
     * @returns - Promise with an array containing the relative paths to directories and files which are different between source 1 and source 2.
     */
    static diff(source1, options1, source2, options2) {
        return new Promise ((resolve, reject) => {
            // Use the built-in shell diff command to compare the outputs of mtree commands on both sources.
            // diff returns a 1 if it found differences, which causes exec to throw an exception. The output is 
            // therefore handled in the catch routine.
            let cmd = `diff <(casync mtree ${this._optionString(options1)} ${source1}) <(casync mtree ${this._optionString(options2)} ${source2})`
            exec(cmd, {shell: '/bin/bash'}).then((stdout, stderr) => {
                if (stderr) {
                    reject(stderr.trim);
                }
                else {
                    resolve ([]);
                }
            }).catch(output => {
                if (output.stderr) {
                    reject(output.stderr.trim());
                }
                else if (output.stdout) {
                    // Parse the diff output
                    let result = [];
                    output.stdout.split('\n').filter(line => line.startsWith('>')).forEach(line => {
                        let arr = line.split(' ');
                        result.push(arr[1]);
                    });
                    resolve(result);
                }
                else {
                    resolve ([]);
                }
            });
        });
    }
}

module.exports.casync = casync;