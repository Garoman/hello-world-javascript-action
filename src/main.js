import * as core from '@actions/core'
import * as github from '@actions/github'
import { STSClient, AssumeRoleWithWebIdentityCommand, AssumeRoleCommand, GetCallerIdentityCommand } from '@aws-sdk/client-sts'
import { S3Client, ListObjectsCommand } from '@aws-sdk/client-s3'

const roleRegex = /arn:aws:iam::[0-9]{12}:.*/g
const audience = 'sts.amazonaws.com'
const region = process.env.REGION || 'eu-west-1'

const stsClient = new STSClient({ region })
const s3Client = new S3Client({ region })

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run() {
  try {
    const targetRoleArn = core.getInput('role-arn', { required: true })
    core.info(`Target Role Arn: ${targetRoleArn}`)

    if (!targetRoleArn) {
      core.error('Role Arn cannot be empty')
      return
    }

    if (!targetRoleArn.match(roleRegex)) {
      core.error('Incorrect Role Arn format')
      return
    }

    const accessToken = process.env.NODE_ENV == 'development' ? process.env.ACCESS_TOKEN : core.getIDToken(audience)

    let params = {
      RoleArn: "arn:aws:iam::038462754764:role/GitHubActionsOIDCRole",
      RoleSessionName: 'FederatedIdentityRole',
      WebIdentityToken: accessToken,
      DurationSeconds: 3600
    }

    let command = new AssumeRoleWithWebIdentityCommand(params)
    let response = await stsClient.send(command)

    let creds = response?.Credentials
    let accessKey = creds?.AccessKeyId
    let secretKey = creds?.SecretAccessKey
    let sessionToken = creds?.SessionToken

    core.exportVariable('AWS_ACCESS_KEY_ID', accessKey)
    core.exportVariable('AWS_SECRET_ACCESS_KEY', secretKey)
    core.exportVariable('AWS_SESSION_TOKEN', sessionToken)

    command = new GetCallerIdentityCommand({})
    response = await stsClient.send(command)
    core.info(response?.UserId)
    
    params = {
      RoleArn: process.env.NODE_ENV == 'development' ? process.env.TARGET_ROLE_ARN : targetRoleArn,
      RoleSessionName: `GHA-${github.context.runId}`,
      Tags: [
        {
          Key: 'event',
          Value: 'push' //cange to github.context.event_name
        },
        {
          Key: 'ref',
          Value: 'aezacme/oidc-token/.github/workflows/oidc-toolkit.yml@refs/heads/main' //cange to github.context.workflow_ref
        },
        {
          Key: 'repo',
          Value: 'aezacme/oidc-token' //cange to github.context.repository
        }
      ],
      TransitiveTagKeys: ['event', 'ref', 'repo'],
      DurationSeconds: 900
    }

    command = new AssumeRoleCommand(params)
    response = await stsClient.send(command)

    creds = response?.Credentials
    accessKey = creds?.AccessKeyId
    secretKey = creds?.SecretAccessKey
    sessionToken = creds?.SessionToken

    core.exportVariable('AWS_ACCESS_KEY_ID', accessKey)
    core.exportVariable('AWS_SECRET_ACCESS_KEY', secretKey)
    core.exportVariable('AWS_SESSION_TOKEN', sessionToken)

    command = new GetCallerIdentityCommand({})
    response = await stsClient.send(command)
    core.info(response?.UserId)
    
    command = new ListObjectsCommand({ Bucket: 'gha-oid-test-bucket' });
    const { Contents } = await s3Client.send(command);
    const contentsList = Contents?.map((c) => ` * ${c.Key}`)?.join("\n");
    core.info(contentsList);
  } catch (error) {
    // Fail the workflow step if an error occurs
    core.setFailed(error.message)
  }
}
