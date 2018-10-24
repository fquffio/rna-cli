function browserslistConfig(entry, data) {
    let name = entry.split(' ')[0];
    let version = entry.split(' ')[1];
    if (version.includes('-')) {
        version = version.split('-')[1];
    }
    switch (name) {
        case 'ios_saf':
            name = 'iphone';
            break;
        case 'and_chr':
        case 'android':
        case 'and_uc':
        case 'samsung':
            name = 'android';
            break;
    }
    // find the correct vm configuration for the requested browser.
    return data.find((vm) => (vm.browser === name) && (parseInt(vm.browser_version) == parseInt(version)));
}

async function fetchPlatforms() {
    const https = require('https');
    const options = {
        host: 'api.browserstack.com',
        port: 443,
        path: '/automate/browsers.json',
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${Buffer.from('edoardo15:jR8QwiZyZ8ygjMzSyyfL').toString('base64')}`,
        },
    };
    return new Promise((resolve, reject) => {
        const request = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk.toString();
            });
            res.on('end', () => {
                resolve(JSON.parse(data));
            });
        });

        request.on('error', (error) => {
            reject(error);
        });

        request.end();
    });
}

module.exports = {
    async fromBrowserslist(browsers) {
        const data = await fetchPlatforms();
        return browsers
            .map((browser) => browserslistConfig(browser, data))
            .filter((def) => !!def)
            .reduce((registry, vm) => {
                registry[`${vm.os}-${vm.browser}-${vm.browser_version}`] = vm;
                return registry;
            }, {});
    },

    async launchers(browsers) {
        let res = await this.fromBrowserslist(browsers);
        for (let k in res) {
            res[k].base = 'BrowserStack';
        }
        return res;
    },
};
