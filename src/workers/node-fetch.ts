export default async function (url: any, init: any) {
  let r = await fetch(url, init);
  for (let i = 1; i < 4 && r.status === 403; i++) {
    console.log('RETRY', i);
    r = await fetch(url, init);
  }
  return r;
}
export const Headers = globalThis.Headers;
export const Request = globalThis.Request;
export const Response = globalThis.Response;
