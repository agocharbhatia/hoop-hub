# Oracle Always Free deployment

Selected constraint: hosting must cost $0; card verification is acceptable. Model API usage remains separate. No Oracle resources have been provisioned, and account access is not configured.

## Resource plan

Use a standard Oracle Free Tier account without upgrading to Pay As You Go. Provision only resources confirmed as Always Free within the account's home region. Prefer one Ubuntu ARM `VM.Standard.A1.Flex` machine with 2 OCPUs, 4 GiB RAM, and a 50 GiB boot volume. These allocations fall within the currently documented Free Tier total of 2 OCPUs, 12 GiB RAM, and 200 GiB combined boot/block storage, assuming the account has no other allocations. Inspect actual tenancy usage and eligibility before provisioning; a trial credit or temporary $0 estimate is not evidence of Always Free eligibility.

Keep the existing Docker Compose deployment, one application process, SQLite, FFmpeg, and persistent Docker volumes. A remote database migration is unnecessary for this path. Build the ARM image on ARM or use a verified multi-platform image; do not push an incompatible local architecture image. The portable Dockerfile has already built locally on ARM, but Oracle runtime/network access is unverified.

Do not create paid compute, a paid load balancer, a purchased domain, storage exceeding the free allowance, or additional services merely to work around unavailable free capacity. If free capacity cannot be allocated, stop and reassess the host while preserving the $0 requirement.

## Deployment sequence after account access

1. Confirm account state, home region, current usage, shape availability, and Always Free eligibility. Create the Ubuntu VM with a dedicated SSH key; keep private keys outside Git and restrict SSH ingress to the operator address.
2. Install Docker/Compose using official distribution packages. Open only the required web ingress ports in Oracle networking and the operating system firewall; keep the application's port 3000 on loopback.
3. Deploy a clean checkout and a new application data volume. Do not transfer the developer's saved research database. Configure credentials in a protected server environment file, never in Git or an image. Confirm provider display entitlements separately.
4. Use an IP-derived `hoop-hub.<actual-public-IP>.sslip.io` hostname and the included Caddy proxy for HTTPS, avoiding a purchased domain or separate DNS account. Set `ORIGIN` to its exact HTTPS origin and `BETA_DOMAIN` to the hostname. Verify real DNS resolution and certificate issuance after the IP is assigned; no hostname or certificate exists yet. This depends on the external DNS service and the instance retaining its public IP. If certificate issuance is rate-limited, follow the provider's documented alternatives without bypassing certificate validation.
5. Start the Compose `public` profile and check health/readiness and the private operator status. Bootstrap/audit current reference data and issue private email-bound invites through the operator CLI.
6. Test an actual hosted research request, streaming progress, mobile artifacts, saved-session persistence after container recreation, NBA source connectivity, clip playback, and a small compiled export. Share the public URL only after these pass.
7. Configure bounded backups within verified free allowances and preserve an independent restorable snapshot before upgrades. Oracle's idle-reclamation policy means this is not guaranteed continuous availability; do not fabricate workload to evade that policy.

See [BETA_DEPLOYMENT.md](BETA_DEPLOYMENT.md) for the existing Compose commands, backup procedure, and acceptance checklist.

## Verified official references

- [Always Free resources, home-region rules, capacity limits, and idle reclamation](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- [Free Tier account lifecycle and upgrade behavior](https://www.oracle.com/cloud/free/faq/)
- [IP-derived DNS and HTTPS certificate support](https://sslip.io/)

Verified on 2026-10-04. Oracle can lack free capacity and can reclaim idle instances. Retain Free Tier account status and provision only confirmed Always Free resources; billing-enabled alternatives must not be substituted without resolving the zero-cost requirement.
