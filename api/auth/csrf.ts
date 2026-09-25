import { handleCsrfRequest } from '../_lib/authFlows.js'

export default {
  fetch(request: Request): Response {
    return handleCsrfRequest(request)
  },
}
