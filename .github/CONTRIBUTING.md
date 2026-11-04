## Contributing to Lyre

Lyre is an independent fork of [Kenku FM](https://github.com/owlbear-rodeo/kenku-fm) by Owlbear Rodeo. Please report problems with Lyre here, not to Owlbear Rodeo.

### Found a bug?

- Search the [issues](https://github.com/nikolaiivanovich38-ship-it/kenku-fm-UI/issues) first.
- If it is new, [open an issue](https://github.com/nikolaiivanovich38-ship-it/kenku-fm-UI/issues/new?template=bug_report.md) and say what you did, what you expected and what happened instead.
- Security problems: use **Security > Report a vulnerability** on the repository instead of a public issue.

### Changing the code

Read [docs/DEVELOPING.md](../docs/DEVELOPING.md). In short:

- Write a failing test first, then the fix.
- `yarn check` must pass before you open a pull request; CI runs the same checks plus the dependency audit, secret scan and CodeQL.
- Update `CHANGELOG.md` under *Unreleased* in plain language.
- Code is licensed GPL-3.0, like the original.
