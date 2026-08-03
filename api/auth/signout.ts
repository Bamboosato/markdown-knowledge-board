import { handleSignOutRequest } from '../_lib/authFlows.js'

export default {
  fetch(request: Request): Response {
    return handleSignOutRequest(request)
  },
}
