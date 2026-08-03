import { handleDisconnectRequest } from '../_lib/authFlows.js'

export default {
  fetch(request: Request): Promise<Response> {
    return handleDisconnectRequest(request)
  },
}
