import { handleAuthSessionRequest } from '../_lib/authSession.js'

export default {
  fetch(request: Request): Promise<Response> {
    return handleAuthSessionRequest(request)
  },
}
