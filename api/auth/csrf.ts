import { handleCsrfRequest } from '../_lib/authFlows.js'

export default function handler(request: Request): Response {
  return handleCsrfRequest(request)
}
