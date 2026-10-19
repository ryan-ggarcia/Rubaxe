// LSP base protocol: JSON-RPC messages framed by a Content-Length header.
export function createParser(onMessage: (msg: unknown) => void): (chunk: Buffer) => void {
  let buf = Buffer.alloc(0);
  return chunk => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const sep = buf.indexOf('\r\n\r\n');
      if (sep < 0) return;
      // Header search tolerates stray stdout text (e.g. bundler output) before the frame.
      const len = /Content-Length:\s*(\d+)/i.exec(buf.subarray(0, sep).toString('ascii'));
      if (!len) { buf = buf.subarray(sep + 4); continue; }
      const start = sep + 4, end = start + Number(len[1]);
      if (buf.length < end) return;
      const body = buf.subarray(start, end).toString('utf8');
      buf = buf.subarray(end);
      onMessage(JSON.parse(body));
    }
  };
}

export function frame(msg: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]);
}
