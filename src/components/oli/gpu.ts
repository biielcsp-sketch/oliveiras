/**
 * Detecção de GPU sem carregar o three.js.
 * Renderizador por software (SwiftShader, llvmpipe, "Microsoft Basic Render"…): cada quadro WebGL
 * trava a thread principal por centenas de ms a segundos (medido no Chromium headless: 1,7 s no
 * primeiro quadro e ~0,7 s nos seguintes, com "GPU stall due to ReadPixels" na composição).
 */
export function isSoftwareRendererName(name: string) {
  return /swiftshader|llvmpipe|softpipe|software|basic render|mesa offscreen/i.test(name);
}

export function isSoftwareRenderer(gl: WebGLRenderingContext | WebGL2RenderingContext) {
  try {
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "");
    return isSoftwareRendererName(name);
  } catch {
    return false;
  }
}

/** "gpu", "software" ou "none" (sem WebGL). Cria um contexto descartável, sem desenhar nada. */
export function probeWebGL(): "gpu" | "software" | "none" {
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") ?? c.getContext("webgl")) as WebGLRenderingContext | WebGL2RenderingContext | null;
    if (!gl) return "none";
    const kind = isSoftwareRenderer(gl) ? "software" : "gpu";
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return kind;
  } catch {
    return "none";
  }
}
