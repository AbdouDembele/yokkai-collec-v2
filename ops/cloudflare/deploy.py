"""Run as root on the origin: prepare, activate, firewall, confirm, rollback.

Upload this directory to /data/yokkai-edge/src first. No secret leaves the origin.
Activation has a 10 minute automatic rollback. Confirm only after external probes.
"""
import ipaddress
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import urllib.request

ROOT = Path('/data/yokkai-edge')
PROXY = Path('/data/coolify/proxy/docker-compose.yml')
DYNAMIC = Path('/data/coolify/proxy/dynamic/yokkai-edge.json')
NETWORK = 'yokkai-edge-private'
UNIT = 'yokkai-edge-rollback'


def run(*args, check=True):
    result = subprocess.run(args, capture_output=True, text=True, timeout=180)
    if check and result.returncode:
        # Commands can contain secrets in future changes; do not print stdout.
        raise RuntimeError('Command failed: ' + args[0] + ' ' + result.stderr[-1000:])
    return result.stdout


def write(path, content, mode=0o600):
    path.write_text(content, encoding='utf-8')
    path.chmod(mode)


def compose(path, *args):
    return run('docker', 'compose', '-f', str(path), *args)


def prepare():
    if (ROOT / 'backup').exists():
        raise RuntimeError('Backup already exists; inspect before another deployment')
    ROOT.mkdir(mode=0o700, exist_ok=True)
    result = json.load(urllib.request.urlopen('https://api.cloudflare.com/client/v4/ips', timeout=20))
    assert result['success']
    ranges = {'4': result['result']['ipv4_cidrs'], '6': result['result']['ipv6_cidrs']}
    write(ROOT / 'ranges.json', json.dumps(ranges))
    containers = json.loads(run('docker', 'inspect', *run('docker', 'ps', '-q').split()))
    hosts = {'coolify.yokkai-collec.com', 'api.yokkai-collec.com'}
    import re
    for container in containers:
        for key, value in (container['Config'].get('Labels') or {}).items():
            if key.startswith('traefik.http.routers.') and key.endswith('.rule'):
                hosts.update(re.findall(r'Host\(`([^`]+)`\)', value))
    for host in hosts:
        addresses = {entry[4][0] for entry in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)}
        assert addresses and all(any(ipaddress.ip_address(ip) in ipaddress.ip_network(cidr)
            for cidr in ranges[str(ipaddress.ip_address(ip).version)]) for ip in addresses), host + ' is not proxied'
    proxy = next(c for c in containers if c['Name'] == '/coolify-proxy')
    app = next(c for c in containers if c['Name'].startswith('/lbugcql3gc8ijtbv7qqy70do-'))
    image = app['Image']  # Exact locally running Node image ID, no mutable tag.
    backup = ROOT / 'backup'
    backup.mkdir(mode=0o700)
    shutil.copy2(PROXY, backup / 'docker-compose.yml')
    write(backup / 'networks.json', json.dumps(list(proxy['NetworkSettings']['Networks'])))
    config = json.loads(compose(PROXY, 'config', '--format', 'json'))
    # Include networks attached by Coolify after its compose was started.
    for name in proxy['NetworkSettings']['Networks']:
        config.setdefault('networks', {})[name] = {'external': True, 'name': name}
        config['services']['traefik'].setdefault('networks', {})[name] = None
    write(backup / 'rollback-compose.json', json.dumps(config))
    for name in ['secrets', 'data']:
        (ROOT / name).mkdir(mode=0o700)
        os.chown(ROOT / name, 1000, 1000)
    for name in ['proxy-proof', 'ip-hmac']:
        path = ROOT / 'secrets' / name
        write(path, secrets.token_hex(32))
        os.chown(path, 1000, 1000)
    write(ROOT / 'secrets/key-version', 'v1')
    os.chown(ROOT / 'secrets/key-version', 1000, 1000)
    if not run('docker', 'network', 'ls', '--filter', 'name=^' + NETWORK + '$', '-q').strip():
        run('docker', 'network', 'create', '--internal', NETWORK)
    service = {'name': 'yokkai-edge', 'services': {'identity': {
        'container_name': 'yokkai-edge-identity', 'image': image, 'entrypoint': ['node'],
        'command': ['/edge/server.mjs'], 'working_dir': '/edge', 'user': '1000:1000',
        'read_only': True, 'cap_drop': ['ALL'], 'security_opt': ['no-new-privileges:true'],
        'restart': 'unless-stopped', 'mem_limit': '160m', 'cpus': 0.5, 'pids_limit': 64,
        'networks': [NETWORK], 'volumes': [str(ROOT / 'src') + ':/edge:ro',
            str(ROOT / 'secrets') + ':/run/secrets:ro', str(ROOT / 'data') + ':/data'],
        'healthcheck': {'test': ['CMD', 'node', '-e',
            "fetch('http://127.0.0.1:9080/health').then(r=>process.exit(r.status===204?0:1)).catch(()=>process.exit(1))"],
            'interval': '10s', 'timeout': '3s', 'retries': 3},
        'logging': {'driver': 'json-file', 'options': {'max-size': '1m', 'max-file': '2'}},
    }}, 'networks': {NETWORK: {'external': True, 'name': NETWORK}}}
    write(ROOT / 'compose.json', json.dumps(service))
    run('docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'node',
        '-v', str(ROOT) + ':/edge-config', '-e', 'EDGE_CONFIG_DIR=/edge-config',
        image, '/edge-config/src/configure.mjs')
    run('nft', '-c', '-f', str(ROOT / 'firewall.nft'))
    config['networks'][NETWORK] = {'external': True, 'name': NETWORK}
    traefik = config['services']['traefik']
    traefik['networks'][NETWORK] = None
    # Pin the running proxy as well; do not upgrade as part of this operation.
    traefik['image'] = proxy['Image']
    traefik['command'] = [arg for arg in traefik['command'] if not arg.startswith('--ping.entrypoint=')]
    traefik['command'] += ['--ping.entrypoint=edge-health', '--entrypoints.edge-health.address=:9081']
    for entry in ['http', 'https']:
        traefik['command'] += [f'--entrypoints.{entry}.http.middlewares=yokkai-edge@file',
            f'--entrypoints.{entry}.forwardedheaders.trustedips=' + ','.join(ranges['4'] + ranges['6']),
            f'--entrypoints.{entry}.forwardedheaders.insecure=false']
    traefik['healthcheck']['test'] = ['CMD-SHELL', 'wget -qO- http://localhost:9081/ping || exit 1']
    write(ROOT / 'proxy-compose.json', json.dumps(config))
    compose(ROOT / 'proxy-compose.json', 'config', '--quiet')
    compose(ROOT / 'compose.json', 'up', '-d')
    print('Prepared: backups, CIDRs, isolated identity service; public proxy unchanged')


def activate():
    assert not (ROOT / 'confirmed').exists()
    run('systemd-run', '--unit=' + UNIT, '--on-active=10m', '/usr/bin/python3',
        str(ROOT / 'src/deploy.py'), 'rollback')
    shutil.copy2(ROOT / 'middleware.json', DYNAMIC)
    shutil.copy2(ROOT / 'proxy-compose.json', PROXY)
    compose(PROXY, 'up', '-d', '--force-recreate')
    print('Proxy activated; rollback timer armed for 10 minutes')


def firewall():
    assert 'active' == run('systemctl', 'is-active', UNIT + '.timer').strip()
    run('nft', '-c', '-f', str(ROOT / 'firewall.nft'))
    run('nft', '-f', str(ROOT / 'firewall.nft'))
    print('Firewall active temporarily; verify external access before confirm')


def load_firewall():
    rules = (ROOT / 'firewall.nft').read_text(encoding='utf-8')
    existing = subprocess.run(['nft', 'list', 'table', 'inet', 'yokkai_cloudflare'],
                              capture_output=True).returncode == 0
    # Atomic replacement of our table only, also safe on a service restart.
    if existing:
        rules = 'delete table inet yokkai_cloudflare\n' + rules
    for command in [['nft', '-c', '-f', '-'], ['nft', '-f', '-']]:
        subprocess.run(command, input=rules, text=True, check=True, timeout=15)


def rollback():
    run('systemctl', 'disable', '--now', 'yokkai-cloudflare-firewall.service', check=False)
    run('nft', 'delete', 'table', 'inet', 'yokkai_cloudflare', check=False)
    shutil.copy2(ROOT / 'backup/rollback-compose.json', PROXY)
    compose(PROXY, 'up', '-d', '--force-recreate')
    shutil.copy2(ROOT / 'backup/docker-compose.yml', PROXY)
    DYNAMIC.unlink(missing_ok=True)
    print('Original proxy and networks restored; dedicated firewall removed')


def confirm():
    run('nft', 'list', 'table', 'inet', 'yokkai_cloudflare')
    unit = '''[Unit]
Description=Cloudflare-only web origin ingress
After=network-pre.target
Before=docker.service
Wants=network-pre.target

[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /data/yokkai-edge/src/deploy.py load-firewall
ExecStop=/usr/sbin/nft delete table inet yokkai_cloudflare
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
'''
    write(Path('/etc/systemd/system/yokkai-cloudflare-firewall.service'), unit, 0o644)
    run('systemctl', 'daemon-reload')
    run('systemctl', 'enable', 'yokkai-cloudflare-firewall.service')
    run('systemctl', 'start', 'yokkai-cloudflare-firewall.service')
    run('systemctl', 'stop', UNIT + '.timer')
    write(ROOT / 'confirmed', 'External probes passed\n')
    print('Persistent firewall enabled; rollback timer cancelled')


if __name__ == '__main__':
    assert os.geteuid() == 0, 'Root required'
    actions = {'prepare': prepare, 'activate': activate, 'firewall': firewall,
               'rollback': rollback, 'confirm': confirm, 'load-firewall': load_firewall}
    actions[sys.argv[1]]()
