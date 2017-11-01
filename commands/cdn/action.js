const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');

/**
 * One-way sync of directory files to an S3 Bucket.
 * 
 * @param {string} sourceDirectory Path to sync.
 * @param {string} destBucket Destination S3 Bucket.
 * @param {string} destPath Base prefix for items stored in S3 Bucket.
 * @returns {Promise<Array<string>>}
 */
const syncS3Files = (sourceDirectory, destBucket, destPath = '') => {
    const s3 = new AWS.S3({
        apiVersion: '2006-03-01',
    });

    /**
     * Synchronously & recursively list all files in a directory.
     * 
     * @param {string} dir Directory path.
     * @returns {Array<string>}
     */
    const walkSync = (dir) => {
        if (dir[dir.length - 1] !== path.sep) {
            // Ensure path ends with a directory separator.
            dir += path.sep;
        }

        let files = [];
        fs.readdirSync(dir).forEach((item) => {
            // List members of directory.
            if (!path.isAbsolute(item)) {
                // Ensure all paths are absolute.
                item = path.join(dir, item);
            }

            if (fs.statSync(item).isDirectory()) {
                files.concat(walkSync(item));
            } else {
                files.push(item);
            }
        });

        return files;
    };

    const putFile = (file) => new global.Promise((resolve, reject) => {
        // Use prefix + file path relative to base directory as object key.
        const key = `${destPath}${path.relative(file, sourceDirectory)}`;

        s3.putObject(
            {
                Bucket: destBucket,
                Key: key,
                Body: fs.readFileSync(file),
            },
            (error, data) => {
                if (error) {
                    reject(error);
                }

                resolve(data.ETag);
            }
        );
    });

    return global.Promise.all(
        walkSync(sourceDirectory).map((file) => putFile(file))
    );
};

/**
 * Find CloudFront Distribution ID for a given CNAME.
 * 
 * @param {string} cname CNAME to look for.
 * @returns {Promise<string>}
 */
const getDistributionIdFromCNAME = (cname) => {
    const cloudFront = new AWS.CloudFront({
        apiVersion: '2017-03-25',
    });

    /**
     * Find distribution.
     * 
     * @param {string|null} Marker Marker.
     * @returns {Promise<string>}
     */
    const findDistribution = (Marker) => new global.Promise((resolve, reject) => {
        cloudFront.listDistributions({Marker}, (error, data) => {
            if (error) {
                // An error occurred.
                reject(error);
                return;
            }

            // Cycle through returned results.
            for (let distribution of data.DistributionList.Items) {
                if (distribution.Aliases.Items.indexOf(cname) !== -1) {
                    // Found!
                    resolve(distribution.Id);
                    return;
                }
            }

            if (!data.DistributionList.IsTruncated) {
                // No results left.
                reject();
            }

            // Try with next page.
            return findDistribution(data.DistributionList.NextMarker);
        });
    });

    return findDistribution();
};

/**
 * Create an invalidation for the given CloudFront Distribution.
 * 
 * @param {string} distributionId CloudFront Distribution ID to create invalidation for.
 * @param {Array<string>} paths Paths to invalidate.
 * @returns {Promise}
 */
const createDistributionInvalidation = (distributionId, paths) => {
    const cloudFront = new AWS.CloudFront({
        apiVersion: '2017-03-25',
    });

    const CallerReference = `${Date.now()}`;

    return new global.Promise((resolve, reject) => {
        cloudFront.createInvalidation(
            {
                DistributionId: distributionId,
                InvalidationBatch: {
                    CallerReference,
                    Paths: {
                        Quantity: paths.length,
                        Items: paths,
                    },
                },
            },
            (error, data) => {
                if (error) {
                    reject(error);
                }

                resolve(data.Invalidation.Id);
            }
        );
    });
};

module.exports = (app, options) => {
    const BUCKET = 'pippo';
    const CNAME = 'paperino';

    /**
     * Map of source directories to S3 key prefixes.
     * 
     * @var {{[x: string]: string}}
     */
    let sourceDirectories = {};
    let invalidationPaths = Object.keys(sourceDirectories)
        .map((path) => `${sourceDirectories[path]}*`);

    return global.Promise.all(
        Object.keys(sourceDirectories)
            .map((path) => syncS3Files(path, BUCKET, sourceDirectories[path]))
    )
        .then(() => getDistributionIdFromCNAME(CNAME))
        .then((distributionId) => createDistributionInvalidation(distributionId, invalidationPaths));
};