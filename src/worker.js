// Child process for svgToPngSubprocess(), see subprocess.js.
import { svgToPng } from './png.js';

process.on('message', ({ id, svg }) => {
  try {
    process.send({ id, png: svgToPng(svg) });
  } catch (err) {
    process.send({ id, error: err.message || String(err) });
  }
});
