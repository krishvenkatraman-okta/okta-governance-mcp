#!/usr/bin/env node
/**
 * Parse Postman collection CLI tool
 *
 * Parses the Okta Governance API Postman collection and outputs endpoint statistics
 */
import { parsePostmanCollection, getEndpointStats } from '../src/catalog/postman-parser.js';
function main() {
    const args = process.argv.slice(2);
    const filePath = args[0] || './postman/Okta Governance API.postman_collection.json';
    console.log('📦 Parsing Postman collection...');
    console.log(`📄 File: ${filePath}\n`);
    try {
        const endpoints = parsePostmanCollection(filePath);
        const stats = getEndpointStats(endpoints);
        console.log('✅ Parsing complete!\n');
        console.log('📊 Statistics:');
        console.log(`   Total endpoints: ${stats.totalEndpoints}`);
        console.log('');
        console.log('📋 Methods:');
        for (const [method, count] of Object.entries(stats.methods)) {
            console.log(`   ${method}: ${count}`);
        }
        console.log('');
        console.log('📁 Families:');
        for (const [family, count] of Object.entries(stats.families)) {
            console.log(`   ${family}: ${count}`);
        }
        console.log('');
        // Show sample endpoints
        console.log('📝 Sample endpoints (first 10):');
        for (const endpoint of endpoints.slice(0, 10)) {
            console.log(`   [${endpoint.method}] ${endpoint.name}`);
            console.log(`       Family: ${endpoint.family}`);
            console.log(`       Path: ${endpoint.path}`);
            console.log('');
        }
        console.log(`💡 Total: ${endpoints.length} endpoints parsed`);
    }
    catch (error) {
        console.error('❌ Error parsing Postman collection:', error);
        process.exit(1);
    }
}
main();
//# sourceMappingURL=parse-postman.js.map