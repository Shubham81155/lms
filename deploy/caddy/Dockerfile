# Caddy with a DNS provider module, needed for the DNS-01 challenge of the wildcard certificate
# (*.LMS_BASE_DOMAIN). Built by docker-compose.prod.yml (repository root); the Caddyfile is mounted at run time.
#
# Versions are pinned. To upgrade, bump CADDY_VERSION (https://github.com/caddyserver/caddy/releases) and the module
# version together and rebuild; a DNS module must be built against the libdns version that Caddy release uses.
#
# Another DNS provider: change DNS_MODULE (and the "dns" line in deploy/Caddyfile), e.g.
#   --build-arg DNS_MODULE=github.com/caddy-dns/route53@<version>
#   --build-arg DNS_MODULE=github.com/caddy-dns/digitalocean@<version>
# Module list: https://caddyserver.com/download (search "dns.providers").
ARG CADDY_VERSION=2.11.7

FROM caddy:${CADDY_VERSION}-builder AS build
ARG DNS_MODULE=github.com/caddy-dns/cloudflare@v0.2.4
RUN xcaddy build --with ${DNS_MODULE}

FROM caddy:${CADDY_VERSION}
COPY --from=build /usr/bin/caddy /usr/bin/caddy
# Fails the build when the module did not make it in.
RUN caddy list-modules | grep -q '^dns.providers\.'
