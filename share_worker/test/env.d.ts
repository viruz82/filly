declare namespace Cloudflare {
  interface Env {
    STORE: DurableObjectNamespace<import('../src/index').ShareStore>
    PUSH_KEY?: string
    TZ?: string
  }
}
