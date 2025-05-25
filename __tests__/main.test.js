import * as core from '@actions/core'
import * as github from '@actions/github'
import { STSClient, AssumeRoleWithWebIdentityCommand, AssumeRoleCommand, GetCallerIdentityCommand } from '@aws-sdk/client-sts'
import { S3Client, ListObjectsCommand } from '@aws-sdk/client-s3'
import { run } from '../main'

jest.mock('@actions/core')
jest.mock('@actions/github')
jest.mock('@aws-sdk/client-sts')
jest.mock('@aws-sdk/client-s3')

describe('run()', () => {
  const mockSend = jest.fn()

  const mockSTSResponse = {
    Credentials: {
      AccessKeyId: 'mockAccessKeyId',
      SecretAccessKey: 'mockSecretAccessKey',
      SessionToken: 'mockSessionToken'
    },
    UserId: 'mock-user-id'
  }

  const mockS3Response = {
    Contents: [
      { Key: 'file1.txt' },
      { Key: 'file2.txt' }
    ]
  }

  beforeEach(() => {
    jest.clearAllMocks()

    // Mock clients
    STSClient.mockImplementation(() => ({ send: mockSend }))
    S3Client.mockImplementation(() => ({ send: jest.fn().mockResolvedValue(mockS3Response) }))

    // Mock inputs
    core.getInput.mockImplementation((key) => {
      if (key === 'role-arn') return 'arn:aws:iam::123456789012:role/MyTestRole'
      return ''
    })

    github.context = {
      runId: '1234',
      eventName: 'push',
      workflow_ref: 'my-repo/.github/workflows/test.yml@refs/heads/main',
      repository: 'my-org/my-repo'
    }

    core.getIDToken = jest.fn().mockResolvedValue('mock-id-token')
  })

  it('runs successfully with valid input', async () => {
    let callCount = 0
    mockSend.mockImplementation((command) => {
      callCount++
      if (command instanceof AssumeRoleWithWebIdentityCommand) return Promise.resolve(mockSTSResponse)
      if (command instanceof GetCallerIdentityCommand) return Promise.resolve({ UserId: 'mock-user-id' })
      if (command instanceof AssumeRoleCommand) return Promise.resolve(mockSTSResponse)
      return Promise.reject(new Error('Unknown command'))
    })

    await run()

    expect(core.exportVariable).toHaveBeenCalledWith('AWS_ACCESS_KEY_ID', 'mockAccessKeyId')
    expect(core.exportVariable).toHaveBeenCalledWith('AWS_SECRET_ACCESS_KEY', 'mockSecretAccessKey')
    expect(core.exportVariable).toHaveBeenCalledWith('AWS_SESSION_TOKEN', 'mockSessionToken')
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('mock-user-id'))
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('file1.txt'))
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('file2.txt'))
    expect(core.setFailed).not.toHaveBeenCalled()
    expect(callCount).toBeGreaterThanOrEqual(2)
  })

  it('fails when role ARN is invalid', async () => {
    core.getInput.mockReturnValueOnce('invalid-role-arn')

    await run()

    expect(core.error).toHaveBeenCalledWith('Incorrect Role Arn format')
    expect(core.setFailed).not.toHaveBeenCalled() // Error is logged but not thrown
  })

  it('fails when no role ARN is provided', async () => {
    core.getInput.mockReturnValueOnce('')

    await run()

    expect(core.error).toHaveBeenCalledWith('Role Arn cannot be empty')
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('handles STS failure gracefully', async () => {
    mockSend.mockRejectedValueOnce(new Error('STS failure'))

    await run()

    expect(core.setFailed).toHaveBeenCalledWith('STS failure')
  })
})
