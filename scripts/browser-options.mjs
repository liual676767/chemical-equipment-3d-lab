// Let Playwright find the installed Edge unless a specific executable is supplied.
const executablePath = process.env.EDGE_PATH;

export const browserOptions = executablePath
  ? { executablePath }
  : { channel: 'msedge' };

export const webglArgs = process.env.VERIFY_GPU === '1'
  ? ['--enable-gpu']
  : ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'];
