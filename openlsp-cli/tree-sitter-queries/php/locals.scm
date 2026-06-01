[
  (function_definition)
  (method_declaration)
  (compound_statement)
] @local.scope

(simple_parameter
	name: (variable_name
	  (name) @local.definition))

(assignment_expression
	left: (variable_name
	  (name) @local.definition))

(variable_name
	(name) @local.reference)
