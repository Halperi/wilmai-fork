/*
 * @wilm-ai/wilma-client for Node: the core client (./core.js) with Node's
 * defaults — requests through undici, files from other sites through the
 * guarded fetcher, and the bundled list of Wilmas read from disk.
 */
import { setDefaultTransport } from "./transport.js";
import { setExternalFetcher } from "./downloads.js";
import { nodeTransport } from "./transport-node.js";
import { fetchExternalFile } from "./external-fetch.js";

setDefaultTransport(nodeTransport);
setExternalFetcher(fetchExternalFile);

export * from "./core.js";
export { nodeTransport } from "./transport-node.js";
export { loadTenantDiscovery, listTenants, searchTenantsByMunicipality, findTenantByUrl } from "./tenants.js";
