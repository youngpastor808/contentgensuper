export function log(service: string, msg: string, isError = false) {
    const ts = new Date().toISOString().slice(11, 23);
    const prefix = `[${ts}] [${service}]`;
    if (isError) {
        console.error(`${prefix} ERROR: ${msg}`);
    } else {
        console.log(`${prefix} ${msg}`);
    }
}
