import { handleCloudBackupContentRequest } from '../_lib/cloudBackups.js'

export default {
  fetch(request: Request): Promise<Response> {
    return handleCloudBackupContentRequest(request)
  },
}
