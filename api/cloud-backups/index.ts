import {
  handleCloudBackupCreateRequest,
  handleCloudBackupDiscoveryRequest,
} from '../_lib/cloudBackups.js'

export default {
  fetch(request: Request): Promise<Response> {
    return request.method === 'GET'
      ? handleCloudBackupDiscoveryRequest(request)
      : handleCloudBackupCreateRequest(request)
  },
}
