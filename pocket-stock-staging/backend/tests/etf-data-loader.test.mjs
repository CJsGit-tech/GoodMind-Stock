export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@appdeploy/sdk') return { url: new URL('./etf-data-mock.test.mjs', import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
}
