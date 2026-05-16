const { createBotClient, postToChannel } = require('../../discord/client');
const { Octokit } = require('@octokit/rest');
const Sandbox = require('../../sandbox');
// Suppress Octokit request logging
process.env.NODE_DEBUG = '';

class TechLeadAgent {
  constructor(spec, projectChannels) {
    this.spec = spec;
    this.projectChannels = projectChannels;
    this.client = createBotClient(process.env.TECHLEAD_TOKEN);
    this.hasSeparateGitHubAccount = !!process.env.TECHLEAD_GITHUB_TOKEN;
    this.octokit = new Octokit({ auth: process.env.TECHLEAD_GITHUB_TOKEN || process.env.GITHUB_TOKEN });
    this.owner = process.env.GITHUB_OWNER;
    this.repo = process.env.GITHUB_REPO;
    this.ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
    this.model = process.env.MANAGER_MODEL || 'llama3.1:8b';

    this.ready = new Promise((resolve) => {
      this.client.once('clientReady', () => {
        console.log(`[TechLead] Online as ${this.client.user.tag}`);
        resolve();
      });
    });
  }

  async run() {
    await this.ready;
    await this.postToManagers(`🔧 Tech Lead online for project: **${this.spec.projectName}**`);
    await this.defineCodingStandards();
    await this.postToManagers(`📐 Coding standards set. Watching for PRs.`);
  }

  async defineCodingStandards() {
    const { techStack } = this.spec.architecture;

    this.standards = {
      language: techStack.language,
      rules: [
        'Use clear, descriptive variable and function names',
        'Add a comment above every function explaining what it does',
        'Handle all errors explicitly — no silent failures',
        'Keep functions small and single-purpose',
        'No hardcoded values — use constants or config',
        'Use exact-match search/replace blocks for all file edits'
      ],
      fileStructure: this.spec.architecture.components,
      techStack
    };

    await this.postToManagers(
      `📐 Coding standards defined:\n\`\`\`json\n${JSON.stringify(this.standards, null, 2)}\n\`\`\``
    );

    return this.standards;
  }

  async reviewPR(prNumber, projectRepo) {
    const owner = projectRepo?.owner || this.owner;
    const repo = projectRepo?.repo || this.repo;

    await this.postToManagers(`🔍 Reviewing PR #${prNumber} in ${owner}/${repo}...`);

    const pr = await this.octokit.pulls.get({ owner, repo, pull_number: prNumber });
    const diff = await this.octokit.pulls.listFiles({ owner, repo, pull_number: prNumber });
    const filesChanged = diff.data.map(f => ({ filename: f.filename, changes: f.changes, patch: f.patch }));

    // Run tests in a sandbox on the PR branch before scoring
    const prBranch = pr.data.head.ref;
    const testResult = await this.runTestsForPR(prBranch, owner, repo);

    if (testResult.passed === true) {
      await this.postToManagers(`✅ Tests passed`);
    } else if (testResult.passed === false) {
      await this.postToManagers(`❌ Tests failed:\n\`\`\`\n${testResult.output.slice(0, 500)}\n\`\`\``);
    } else {
      await this.postToManagers(`⚠️ Tests not run: ${testResult.output}`);
    }

    const score = await this.scorePR(pr.data, filesChanged, testResult);

    // Tests failed → always reject, regardless of score
    const approved = testResult.passed !== false && score.score >= 3;

    const reviewBody = approved
      ? `✅ Tech Lead review complete.\n\n**Score: ${score.score}/10**\n\n${score.feedback}`
      : testResult.passed === false
        ? `❌ Tech Lead review — tests failed.\n\n**Score: ${score.score}/10**\n\n${score.feedback}\n\n**Test output:**\n\`\`\`\n${testResult.output.slice(0, 800)}\n\`\`\``
        : `❌ Tech Lead review — changes needed.\n\n**Score: ${score.score}/10**\n\n${score.feedback}`;

    if (approved) {
      if (this.hasSeparateGitHubAccount) {
        await this.octokit.pulls.createReview({ owner, repo, pull_number: prNumber, event: 'APPROVE', body: reviewBody });
      } else {
        await this.octokit.issues.createComment({ owner, repo, issue_number: prNumber, body: reviewBody });
      }

      await this.octokit.pulls.merge({ owner, repo, pull_number: prNumber, merge_method: 'squash' });

      const issueMatch = pr.data.body?.match(/Closes #(\d+)/);
      if (issueMatch) {
        await this.octokit.issues.update({ owner, repo, issue_number: parseInt(issueMatch[1]), state: 'closed' });
        console.log(`[TechLead] Closed Issue #${issueMatch[1]}`);
      }

      console.log(`[TechLead] ✅ PR #${prNumber} merged in ${owner}/${repo}. Score: ${score.score}/10`);
      await this.postToManagers(`✅ PR #${prNumber} merged. Score: ${score.score}/10\n${score.feedback}`);

      await new Promise(resolve => setTimeout(resolve, 8000));
      await this.checkProjectComplete(owner, repo, prNumber);

      return { approved: true, score, testResult };
    } else {
      if (this.hasSeparateGitHubAccount) {
        await this.octokit.pulls.createReview({ owner, repo, pull_number: prNumber, event: 'REQUEST_CHANGES', body: reviewBody });
      } else {
        await this.octokit.issues.createComment({ owner, repo, issue_number: prNumber, body: reviewBody });
      }

      await this.postToManagers(`❌ PR #${prNumber} rejected. Score: ${score.score}/10\n${score.feedback}`);
      return { approved: false, score, testResult };
    }
  }

  /**
   * Creates a Sandbox on the PR branch, runs the test suite, and tears down.
   * Returns { passed, output } — passed is null if tests could not be run.
   */
  async runTestsForPR(branch, owner, repo) {
    const sandbox = new Sandbox({
      repoUrl: `https://github.com/${owner}/${repo}.git`,
      branch,
      token: process.env.GITHUB_TOKEN,
    });

    try {
      await sandbox.boot();
      return await this.runTests(sandbox);
    } catch (err) {
      console.error(`[TechLead] Sandbox error for branch ${branch}: ${err.message}`);
      return { passed: null, output: `Sandbox error: ${err.message}` };
    } finally {
      await sandbox.teardown();
    }
  }

  /**
   * Detects the test command from package.json and runs it inside the sandbox.
   * Returns { passed: boolean|null, output: string }
   *   passed = true  → tests ran and all passed
   *   passed = false → tests ran and failed
   *   passed = null  → could not determine (no package.json, no test script)
   */
  async runTests(sandbox) {
    let pkg;
    try {
      pkg = JSON.parse(await sandbox.readFile('package.json'));
    } catch {
      return { passed: null, output: 'No package.json found' };
    }

    const testScript = pkg.scripts?.test;
    const noOpScript = 'echo "Error: no test specified" && exit 1';
    if (!testScript || testScript === noOpScript) {
      return { passed: null, output: 'No test script defined in package.json' };
    }

    const install = await sandbox.exec('npm install');
    if (install.exitCode !== 0) {
      return { passed: false, output: `npm install failed:\n${install.stderr || install.stdout}` };
    }

    const test = await sandbox.exec('npm test');
    const output = [test.stdout, test.stderr].filter(Boolean).join('\n');
    return { passed: test.exitCode === 0, output };
  }

  async scorePR(pr, files, testResult = null) {
    const testContext = testResult
      ? `\nTest results: ${testResult.passed === true ? 'PASSED' : testResult.passed === false ? 'FAILED' : 'NOT RUN'}\n${testResult.output.slice(0, 400)}`
      : '';

    const prompt = `You are a Tech Lead reviewing a pull request.

Coding standards:
${JSON.stringify(this.standards?.rules || [], null, 2)}

PR title: ${pr.title}
PR description: ${pr.body}
${testContext}
Files changed:
${JSON.stringify(files, null, 2)}

Score this PR from 1-10 based on:
- Does it meet the acceptance criteria?
- Does it follow coding standards?
- Is the code clear and well-commented?
- Are errors handled?

Return ONLY valid JSON with no other text:
{"score":5,"feedback":"your feedback here","issues":[]}`;

    const response = await fetch(`${this.ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt, stream: false, options: { temperature: 0.1 } }),
    });

    const data = await response.json();
    const text = data.response.trim();

    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');
      return JSON.parse(jsonMatch[0]);
    } catch (err) {
      console.error('[TechLead] Failed to parse score JSON:', err.message);
      return { score: 5, feedback: 'Score parsing failed — review manually', issues: [] };
    }
  }

  async checkProjectComplete(owner, repo) {
    try {
      const { data: openPRs } = await this.octokit.pulls.list({ owner, repo, state: 'open' });
      const { data: openIssues } = await this.octokit.issues.listForRepo({ owner, repo, state: 'open' });
      const filteredIssues = openIssues.filter(i => !i.pull_request && !i.html_url.includes('/pull/'));

      console.log(`[TechLead] checkProjectComplete: ${openPRs.length} open PRs, ${filteredIssues.length} open Issues`);

      if (openPRs.length === 0 && filteredIssues.length === 0) {
        console.log(`[TechLead] Project ${this.spec.projectName} appears complete.`);
        await postToChannel(
          this.client,
          process.env.DISCORD_CHANNEL_DIRECTOR,
          `✅ **Project ${this.spec.projectName} appears complete.**\n\n` +
          `All PRs merged and Issues closed.\n` +
          `Project repo: https://github.com/${owner}/${repo}\n\n` +
          `Type \`close: ${this.spec.projectName}\` to confirm and close, or open new Issues to continue.`
        );
      }
    } catch (err) {
      console.error(`[TechLead] Error checking project completion: ${err.message}`);
    }
  }

  async postToManagers(content) {
    await postToChannel(this.client, this.projectChannels.managers, content);
  }

  async discard() {
    console.log(`[TechLead] Discarding for project: ${this.spec.projectName}`);
    await this.client.destroy();
  }
}

module.exports = TechLeadAgent;
