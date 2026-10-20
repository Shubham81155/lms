import { config } from '../config';

// In production every cookie the API sets is a `__Host-` cookie: browsers then only accept it from this exact
// host, over HTTPS, with Path=/ and no Domain. Organisations live on sibling subdomains of one site, so without
// the prefix a script on one of them (a SCORM package, say) could set a Domain-wide cookie that logs visitors
// of another organisation into the attacker's session. Local http setups keep plain names, which browsers
// would refuse with the prefix.

export const securePrefix = () => config.NODE_ENV === 'production';

/** The cookie's name as sent: `__Host-<name>` in production, `<name>` elsewhere. */
export const cookieName = (name: string) => (securePrefix() ? `__Host-${name}` : name);

/** The path a cookie is set with: `__Host-` cookies must use `/`, elsewhere the narrower path is kept. */
export const cookiePath = (path: string) => (securePrefix() ? '/' : path);
