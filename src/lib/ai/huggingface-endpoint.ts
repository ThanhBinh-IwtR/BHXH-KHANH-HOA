export function huggingFaceModelEndpoint(baseUrl: string, model: string): string {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  const inferenceBaseUrl = normalizedBaseUrl.endsWith('/hf-inference')
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}/hf-inference`;
  return `${inferenceBaseUrl}/models/${model}`;
}
