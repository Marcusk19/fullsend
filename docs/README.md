# README

Fullsend is a framework to bring agents to CI systems. It automates
tasks as triage, implementation and review, all within your system of choice.
By default it ships some agents such as Triage, Code, Fix, Review, Retro... but
you can bring your own agents and use it within the constraints Fullsend gives you.

One of the strong points of Fullsend is its usage of sandboxing and credential
management for agents. Short-lived tokens are always used and agents run always
within a sandbox, limiting its internet connectivty. Before an after an agent
executes Fullsend runs a deterministic set of steps in a pre and post scripts,
along security checks to prevent injection and secret exfiltration.

Visit the [Fullsend GitHub repository](https://github.com/fullsend-ai/fullsend)
or explore this documentation for more information.
