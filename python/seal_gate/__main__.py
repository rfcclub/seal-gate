"""python -m seal_gate review --output <file> [--spec <file>] [--evidence <file>] [--artifact-type <type>]"""
import argparse
import json
import sys
import os


def main():
    parser = argparse.ArgumentParser(prog='seal_gate', description='Seal Gate quality gate')
    sub = parser.add_subparsers(dest='command')

    review = sub.add_parser('review', help='Review an AI output artifact')
    review.add_argument('--output', required=True, help='Path to output file to review')
    review.add_argument('--spec', default=None, help='Path to spec file')
    review.add_argument('--evidence', default=None, help='Path to evidence JSON file')
    review.add_argument('--artifact-type', default='llm_response',
                        choices=['llm_response', 'code_diff', 'test_plan', 'design', 'migration'],
                        help='Artifact type')

    args = parser.parse_args()

    if args.command != 'review':
        parser.print_help(sys.stderr)
        sys.exit(2)

    if not os.path.exists(args.output):
        print(f'Error: output file not found: {args.output}', file=sys.stderr)
        sys.exit(2)

    with open(args.output) as f:
        output_text = f.read()

    spec_text = None
    if args.spec and os.path.exists(args.spec):
        with open(args.spec) as f:
            spec_text = f.read()

    evidence = {'test_log': '', 'build_log': '', 'diff': '', 'references': []}
    if args.evidence and os.path.exists(args.evidence):
        with open(args.evidence) as f:
            evidence = json.load(f)

    from seal_gate import Seal
    verdict = Seal.review({
        'artifact_type': args.artifact_type,
        'spec': spec_text,
        'output': output_text,
        'evidence': evidence,
        'risk_hint': None,
    })

    print(json.dumps(verdict.to_dict(), indent=2))

    passing = verdict.verdict in ('PASS', 'PASS_WITH_WARNINGS')
    sys.exit(0 if passing else 1)


if __name__ == '__main__':
    main()
