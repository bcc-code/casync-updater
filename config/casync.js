/**
 * Wrapper for casync
 */

const util = require('util');
const exec = util.promisify(require('child_process').exec);
const fs = require('fs');

/**
 * Nodejs wrapper for casync (see https://github.com/systemd/casync) with added functionality
 */
class casync {
    /**
     * Creates a casync archive (For more information, see man casync.) and writes the checksum to the index path.
     * @param {String} index - Index file name
     * @param {String} source - Path to directory or device
     * @param {Object} options - casync options in the following format: [ {option1: value}, {option2, value}, ... , {optionN: value} ] }. For more information, see man casync.
     * @returns - Promise with checksum when archive is created
     */
    static make(index, source, options) {
        return new Promise((resolve, reject) => {
            exec(`casync make ${this._optionString(options)} ${index} ${source}`).then(data => {
                if (data.stderr && data.stderr != '') {
                    reject(data.stderr.toString());
                }
                else {
                    let checksum = data.stdout.trim();

                    // Write checksum to disk
                    this.writeFile(index + ".cks", checksum);

                    // Calculate mtree
                    this.mtree(index, options).then(data => {
                        if (data) {
                            this.writeFile(index + ".mtree", data);
                        }
                        // Return checksum with promise
                        resolve(checksum);
                    }).catch(err => {
                        reject(err.message);
                    });
                }
            }).catch(err => {
                reject(err.message);
            });
        });
    }

    /**
     * Extracts a casync archive. For more information, see man casync.
     * @param {string} index - Index file name
     * @param {string} destination - Path to directory or device
     * @param {Object} options - casync options in the following format: [ {option1: value}, {option2, value}, ... , {optionN: value} ] }. For more information, see man casync.
     * @returns - Promise when archive is extracted
     */
    static extract(index, destination, options) {
        return new Promise((resolve, reject) => {
            exec(`casync extract ${this._optionString(options)} ${index} ${destination}`).then(data => {
                if (data.stderr && data.stderr != '') {
                    reject(data.stderr.toString());
                }
                else if (data.stdout) {
                    resolve(data.stdout.toString());
                }
                else {
                    resolve();
                }
            }).catch(err => {
                reject(err.message);
            });
        });
    }

    /**
     * Checks if there is an existing checksum file for the target, and returns the checksum. If not, calculates the checksum of the target casync archive, directory or device. For more information, see man casync.
     * @param {String} target 
     * @param {Object} options - casync options in the following format: [ {option1: value}, {option2, value}, ... , {optionN: value} ] }. For more information, see man casync.
     * @returns - Promise containing the checksum
     */
    static digest(target, options) {
        return new Promise((resolve, reject) => {
            // Check if there is a checksum file
            this.readFile(target + ".cks").then(checksum => {
                if (checksum) {
                    resolve(checksum);
                }
                else {
                    // Digest target
                    exec(`casync digest ${this._optionString(options)} ${target}`).then(data => {
                        resolve(data.stdout.trim());
                    }).catch(err => {
                        reject(err.message);
                    });
                }
            }).catch(err => {
                reject(err.message);
            });
        });
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
     * Performs a casync mtree on a target
     * @param {*} target 
     * @param {*} options 
     * @returns 
     */
    static mtree(target, options) {
        return new Promise((resolve, reject) => {
            let cmd = `casync mtree ${this._optionString(options)} ${target}`;
            exec(cmd, { shell: '/bin/bash' , maxBuffer: 1024000000}).then(data => {
                if (data.stderr && data.stderr != '') {
                    reject(data.stderr.toString());
                }
                else if (data.stdout) {
                    resolve(data.stdout.toString());
                }
                else {
                    resolve();
                }
            }).catch(err => {
                reject(err.message);
            });
        });
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
        return new Promise(async (resolve, reject) => {
            // Get mtree file(s)
            let mtree1;
            await this.readFile(source1 + ".mtree").then(data => { mtree1 = data }).catch(err => {});
            let mtree2;
            await this.readFile(source2 + ".mtree").then(data => { mtree2 = data }).catch(err => {});

            // Check if mtree file output is valid, and run mtree if not valid
            if (!mtree1) {
                await this.mtree(source1, options1).then(data => { mtree1 = data }).catch(err => { reject(err) });
            }
            if (!mtree2) {
                await this.mtree(source2, options2).then(data => { mtree2 = data }).catch(err => { reject(err) });
            }

            // Use the built-in shell diff command to compare the outputs of mtree commands on both sources.
            // diff returns a 1 if it found differences, which causes exec to throw an exception. The output is 
            // therefore handled in the catch routine.
            let cmd = `diff <(echo "${mtree1}") <(echo "${mtree2}")`
            exec(cmd, { shell: '/bin/bash' }).then((stdout, stderr) => {
                if (stderr) {
                    reject(stderr.trim);
                }
                else {
                    resolve([]);
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
                    resolve([]);
                }
            });
        });
    }

    /**
     * Read a file from an web or local path
     * @param {*} path 
     * @returns Promise with the file contents (if found)
     */
    static readFile(path) {
        return new Promise((resolve, reject) => {
            // Determine if index is on disk or web
            if (path.startsWith('http') || path.startsWith('ftp')) {
                this.wget(path).then(data => {
                    resolve(data);
                }).catch(err => {
                    reject(err);
                });
            }
            else {
                // Assume local file path
                try {
                    let data = fs.readFileSync(path);
                    resolve(data.toString());
                }
                catch (error) {
                    resolve();
                }
            }
        });
    }

    /**
     * Download a file with wget, and return the file contents
     * @param {*} url 
     * @returns - Returns a promise with the text data when complete
     */
    static wget(url) {
        return new Promise((resolve, reject) => {
            try {
                let cmd = `wget -q --retry-connrefused --tries=10 --no-http-keep-alive -O '-'
                --header 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9'
                --header 'Accept-Encoding: gzip, deflate, br'
                --header 'Accept-Language: en-US,en;q=0.9,no;q=0.8,fr;q=0.7'
                --header 'User-Agent: Mozilla/5.0 (X11; Linux armv7l) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36'
                '${url}'`.replace(/\n/g, ' ');  // replace newline characters with space

                exec(cmd, { maxBuffer: 1024000000 }).then(data => {     // Increased maxbuffer to allow large files to be downloaded (default is 200kb(?)).
                    if (data.stderr) {
                        reject(data.stderr);
                    }
                    else if (data.stdout) {
                        resolve(data.stdout);
                    }
                    else {
                        resolve();
                    }
                });
            }
            catch (error) {
                reject(error.message);
            }
        });
    }

    /**
     * Write file to disk
     * @param {*} path - file path
     * @param {*} data - data
     */
    static writeFile(path, data) {
        fs.writeFileSync(path, data);
    }
}

module.exports.casync = casync;