#!/usr/bin/env node
import { Command } from "commander";
import { formatReport, runEval } from "./index.ts";

const program = new Command();

program
  .name("schema-eval")
  .description("Score how well an LLM's structured-output extraction matches expectations.")
  .version("0.1.0");

program
  .command("run")
  .description("Run all test cases against the model and report the score.")
  .option("-c, --config <path>", "path to the config file", "schema-eval.config.ts")
  .action(async (options: { config: string }) => {
    const report = await runEval(options.config);
    console.log(formatReport(report));
    if (!report.passed) process.exitCode = 1;
  });

program.parseAsync(process.argv);
