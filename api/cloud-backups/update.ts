import { handleCloudBackupUpdateRequest } from '../_lib/cloudBackups.js'

export default {
  fetch(request: Request): Promise<Response> {
    return handleCloudBackupUpdateRequest(request)
  },
}
