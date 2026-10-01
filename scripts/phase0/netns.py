#!/usr/bin/env python3
"""Activate loopback in an already-created unprivileged network namespace.
No routes, virtual external interfaces, credential handling or application SDKs.
"""
import fcntl
import os
from pathlib import Path
import socket
import struct
import sys

try:
    parent = int(os.environ['HDL_PHASE0_PARENT_NETNS'])
    if Path('/proc/self/ns/net').stat().st_ino == parent:
        raise RuntimeError('fresh network namespace was not created')
    interfaces = [line.split(':')[0].strip() for line in Path('/proc/net/dev').read_text().splitlines() if ':' in line]
    if interfaces != ['lo']:
        raise RuntimeError('only loopback may exist in TEST')
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as control:
        current = fcntl.ioctl(control, 0x8913, struct.pack('16sH14x', b'lo', 0))
        flags = struct.unpack('16sH14x', current)[1]
        fcntl.ioctl(control, 0x8914, struct.pack('16sH14x', b'lo', flags | 1))
    # Reserved documentation addresses, never a production endpoint. A usable
    # route would invalidate the boundary before any payload is executed.
    for family, address in [(socket.AF_INET, ('203.0.113.10', 443)), (socket.AF_INET6, ('2001:db8::10', 443))]:
        with socket.socket(family, socket.SOCK_STREAM) as probe:
            probe.settimeout(0.5)
            try:
                probe.connect(address)
            except OSError as error:
                if error.errno not in (101, 113):
                    raise RuntimeError('external-route negative control was inconclusive') from None
            else:
                raise RuntimeError('external route is reachable')
    if len(sys.argv) != 3:
        raise RuntimeError('fixed Node payload and action required')
    os.execv(sys.argv[1], [sys.argv[1], str(Path(__file__).with_name('inside.mjs')), sys.argv[2]])
except Exception as error:
    print('[Phase0 BLOCKED] isolation setup: ' + str(error), file=sys.stderr)
    sys.exit(78)
