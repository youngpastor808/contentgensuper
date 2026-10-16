/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */


export type ExportDeviceProfile = {
    make: string;
    model: string;
    software?: string;
};


export function getExportDeviceProfile(aspectRatio?: string): ExportDeviceProfile {
    switch (aspectRatio) {
        case '16:9':
        case '4:3':
            return {
                make: 'Canon',
                model: 'EOS R5',
                software: 'Canon Firmware 2.0.0'
            };

        case '9:16':
        case '1:1':
        case '3:4':
        default:
            return {
                make: 'Apple',
                model: 'iPhone 14',
                software: '17.5.1'
            };
    }
}
