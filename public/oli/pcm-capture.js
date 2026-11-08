// AudioWorklet do Oli: repassa cada bloco do microfone para a página.
// Arquivo estático do próprio domínio (a CSP com nonce + strict-dynamic aceita; Blob URL não é necessário).
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
