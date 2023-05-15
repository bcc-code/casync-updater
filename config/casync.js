/**
 * Wrapper for casync
 */

const util = require('util');
const execP = util.promisify(require('child_process').exec);
const { exec, execSync } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

/**
 * Nodejs wrapper for casync (see https://github.com/systemd/casync) with added functionality
 */
class casync {
    /**
     * Creates a casync archive (For more information, see man casync.) and writes the checksum & timestamp to the index path.
     * @param {String} index - Index file name
     * @param {String} source - Path to directory or device
     * @param {Object} options - casync options in the following format: [ {option1: value}, {option2, value}, ... , {optionN: value} ] }. For more information, see man casync.
     * @param {Object} override_cks - Optional path to an override checksum file to be used as the output archive's .cks checksum file.
     * @returns - Promise with checksum and timestamp when archive is created
     */
    static make(index, source, options, override_cks) {
        return new Promise((resolve, reject) => {
            // validate data
            let dirName = path.dirname(index);
            if (!this.dirExists(dirName)) reject(`Unable to make archive: Destination directory does not exist for ${index}`);
            if (!this.dirExists(source)) reject(`Unable to make archive: Source directory ${source} does not exist`);
            if (this.dirEmpty(source)) reject(`Unable to make archive: Source directory ${source} is empty`);

            execP(`casync make ${this._optionString(options)} ${index} ${source}`).then(data => {
                if (data.stderr && data.stderr != '') {
                    reject(data.stderr.toString());
                }
                else {
                    let checksum_data;
                    if (override_cks) {
                        // Load checksum file from disk
                        try {
                            checksum_data = JSON.parse(fs.readFileSync(override_cks));
                            // validate checksum file
                            if (!checksum_data.checksum || !checksum_data.timestamp) {
                                reject(`Invalid source checksum file for ${source}`);
                            }
                        } catch (err) {
                            reject(`Invalid source checksum file for ${source}: ${err.message}`);
                        }
                    } else {
                        // Calculate checksum if not overridden
                        checksum_data = {
                            checksum: data.stdout.trim(),
                            timestamp: Date.now()
                        };
                    }

                    // Write checksum & timestamp to disk
                    this.writeFile(index + ".cks", JSON.stringify(checksum_data));

                    // Calculate mtree
                    this.mtree(index, options).then(data => {
                        if (data) {
                            this.writeFile(index + ".mtree", data);
                        }
                        // Return checksum & timestamp with promise
                        resolve(checksum_data);
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
     * @param {string} destination - Path to directory (single files currently not supported)
     * @param {Object} options - casync options in the following format: [ {option1: value}, {option2, value}, ... , {optionN: value} ] }. For more information, see man casync.
     * @param {string} checksum_file - optional file path where the source (as per index) checksum file should be copied to.
     * @returns - Promise when archive is extracted
     */
    static extract(index, destination, options, checksum_file) {
        return new Promise((resolve, reject) => {
            if (this.dirExists(destination)) {
                // Extract archive
                execP(`casync extract ${this._optionString(options)} ${index} ${destination}`).then(data => {
                    if (data.stderr && data.stderr != '') {
                        reject(data.stderr.toString());
                    }
                    else if (data.stdout) {
                        return data.stdout.toString();
                    }
                    else {
                        return;
                    }
                }).then(data => {
                    // Read checksum
                    if (checksum_file) {
                        this.readFile(checksum_file).then(cks_data => {
                            // Write checksum to disk
                            try {
                                this.writeFile(checksum_file, cks_data);
                                resolve(JSON.parse(cks_data));
                            } catch (err) {
                                reject(err);
                            }
                        }).catch(err => reject(err));
                    }
                }).catch(err => {
                    reject(err.message);
                });
            } else {
                reject(`Destination directory ${destination} does not exist`)
            }
        });
    }

    /**
     * Checks if there is an existing checksum file for the target, and returns the checksum. If not, calculates the checksum of the target casync archive, directory or device. For more information, see man casync.
     * @param {String} target 
     * @param {Object} options - casync options in the following format: [ {option1: value}, {option2, value}, ... , {optionN: value} ] }. For more information, see man casync.
     * @param {string} checksum_file - Optional path to checksum file. This can be used to specify the location of a checksum file when digesting a directory. If the file is specified, the checksum will be read from the file and not calculated from the directory contents.
     * @returns - Promise containing the checksum and timestamp
     */
    static digest(target, options, checksum_file) {
        if (!checksum_file) {
            checksum_file = target + ".cks";
        }
        return new Promise((resolve, reject) => {
            // Check if there is a checksum & timestamp file
            this.readFile(checksum_file).then(data => {
                let o;
                if (data) {
                    try {
                        o = JSON.parse(data)
                        resolve(o);
                    } catch (err) {
                        console.log(`Digest: Unable to parse checksum data for ${target}: ${err.message}`);
                    }
                }
                if (!o) {
                    // Digest target
                    console.log(`Digest: calculating checksum from file structure / archive for ${target}`);
                    execP(`casync digest ${this._optionString(options)} ${target}`).then(data => {
                        resolve({ checksum: data.stdout.trim() });
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
        if (options) {
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
            execP(cmd, { shell: '/bin/bash', maxBuffer: 1024000000 }).then(data => {
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
            try {
                // Get mtree file(s)
                let mtree1;
                await this.readFile(source1 + ".mtree").then(data => { mtree1 = data }).catch(err => { });
                let mtree2;
                await this.readFile(source2 + ".mtree").then(data => { mtree2 = data }).catch(err => { });

                // Check if mtree file output is valid, and run mtree if not valid
                if (!mtree1) {
                    await this.mtree(source1, options1).then(data => { mtree1 = data }).catch(err => { reject(err) });
                }
                if (!mtree2) {
                    await this.mtree(source2, options2).then(data => { mtree2 = data }).catch(err => { reject(err) });
                }

                // Generate unique tmp directory name
                let tmpDir = '/tmp/casync-updater-' + crypto.randomBytes(20).toString('hex');
                let tmpSize = Math.round((mtree1.length + mtree2.length) * 4 / 1024 + 1) * 1024;

                // Create tmpfs
                execSync(`
                # make tmp dir
                mkdir -p ${tmpDir}

                # mount tmpfs
                mount -t tmpfs -o size=${tmpSize} tmpfs ${tmpDir}
                `, { shell: "/bin/bash" });

                // Write mtree files to tmp dir
                fs.writeFileSync(tmpDir + '/mtree1', mtree1);
                fs.writeFileSync(tmpDir + '/mtree2', mtree2);

                // Use the built-in shell diff command to compare the outputs of mtree commands on both sources.
                // diff exits with exit code 1 when difference is detected, causing exec(Sync) to throw an error.
                // As this is normal operation, the error is catched.
                try {
                    execSync(`
                    diff ${tmpDir}/mtree1 ${tmpDir}/mtree2 > ${tmpDir}/diff
                    `, { shell: "/bin/bash" });
                }
                catch { }


                // Read diff output
                let diff = fs.readFileSync(tmpDir + '/diff').toString();

                // Cleanup
                execSync(`
                umount ${tmpDir}
                rm -rf ${tmpDir}
                `, { shell: "/bin/bash" });


                // Parse the diff output
                if (diff) {
                    let result = [];
                    diff.split('\n').filter(line => line.startsWith('>')).forEach(line => {
                        let arr = line.split(' ');
                        result.push(arr[1]);
                    });
                    resolve(result);
                }
                else {
                    resolve([]);
                }
            }
            catch (err) {
                reject(err.message);
            }
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

                // Increased maxbuffer to allow large files to be downloaded (default is 200kb(?)).
                exec(cmd, { maxBuffer: 1024000000 }, (error, stdout, stderr) => {
                    if (error) {
                        reject(error.message);
                    }
                    else if (stderr) {
                        reject(stderr);
                    }
                    else if (stdout) {
                        resolve(stdout);
                    }
                    else {
                        resolve();
                    }
                });
            }
            catch (err) {
                reject(err.message);
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

    /**
     * Check if a directory exists
     * @param {string} path 
     * @returns - true if the directory exists
     */
    static dirExists(path) {
        let p = path;
        if (!p.endsWith('/')) { p += '/' }

        return fs.existsSync(p);
    }

    /**
     * Determine whether the given `path` points to an empty directory.
     * @param {string} path 
     * @returns {Boolean}
     */
    static dirEmpty(path) {
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
}

module.exports.casync = casync;