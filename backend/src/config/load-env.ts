import * as path from 'path'
import * as dotenv from 'dotenv'

const backendDir = path.resolve(__dirname, '..', '..')
const projectRoot = path.resolve(backendDir, '..')

for (const envPath of [
    path.join(projectRoot, '.env'),
    path.join(backendDir, '.env'),
]) {
    dotenv.config({ path: envPath, quiet: true })
}
