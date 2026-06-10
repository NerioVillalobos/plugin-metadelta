export function isIgnoredMonitorFile(filePath) {
    return /_SampleInputJson\.json$/i.test(filePath);
}
export function isSampleInputJsonError(message) {
    return /_SampleInputJson\.json/i.test(String(message ?? '')) && /JSON Parsing Error|Unexpected non-whitespace character after JSON/i.test(String(message ?? ''));
}
